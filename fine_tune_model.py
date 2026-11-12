#!/usr/bin/env python3
"""
Fine-Tuning Script for NASA Microgravity Flammability Prediction
Fine-tunes Qwen-0.6B using LoRA (Low-Rank Adaptation) on Apple Silicon MPS.
Predicts flammability regimes:
0: Sustained Burn
1: Radiative Extinction
2: Blowoff
"""

import os
import json
import torch
import numpy as np
import pandas as pd
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification, get_cosine_schedule_with_warmup
from peft import LoraConfig, get_peft_model, TaskType
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix

BASE_MODEL_PATH = os.environ.get("SHUNNO_BASE_MODEL", "Qwen/Qwen3-0.6B")
OUTPUT_DIR = "models/fine_tuned_qwen_flammability"

LABEL2ID = {
    "Sustained Burn": 0,
    "Radiative Extinction": 1,
    "Blowoff": 2
}
ID2LABEL = {v: k for k, v in LABEL2ID.items()}

def _prompt_for(mat, thk, flow, o2, p):
    da = (o2 / 21.0) / (1.0 + (flow / 6.0)**1.5)
    rad = 1.0 / (max(0.2, flow) * max(0.1, o2 / 21.0))
    return (f"NASA Microgravity Combustion Mission. Material: {mat}. "
            f"Fuel Thickness: {thk:.1f} mm. Forced Airflow Velocity: {flow:.1f} cm/s. "
            f"Oxygen Concentration: {o2:.1f}% O2. Cabin Pressure: {p:.1f} psi. "
            f"Damköhler Reaction Proxy: {da:.2f}. Radiative Loss Index: {rad:.2f}. "
            f"Gravity: Microgravity (0 g, absence of natural buoyant updraft). "
            f"What is the flame-spread flammability regime?")


def generate_augmented_training_samples():
    """
    Physics-reconciled flight records + a dense digital-twin-labeled exploration grid.
    Labels come from the authoritative combustion digital twin (single source of truth),
    so the transformer, XGBoost engine, and digital twin agree everywhere in the app.
    """
    from shunnoshikha.digital_twin import CombustionDigitalTwin
    twin = CombustionDigitalTwin()

    df_master = pd.read_csv("data/flammability_master_dataset.csv")
    samples = []

    for _, r in df_master.iterrows():
        status = r["flammability_status"]
        if status not in LABEL2ID:
            continue
        mat = r["sample_material"]
        thk = float(r["sample_thickness_mm"])
        flow = float(r["airflow_velocity_cms"])
        o2 = float(r["O2_concentration_pct"])
        p = float(r["cabin_pressure_psi"])
        samples.append({
            "text": _prompt_for(mat, thk, flow, o2, p),
            "label": LABEL2ID[status], "status": status,
            "material": mat, "o2": o2, "flow": flow, "pressure": p,
        })

    # Dense physics grid across the full exploration envelope (twin-labeled).
    for mat in ["PMMA", "Nomex", "Cotton-Fiber Blend"]:
        for o2 in np.linspace(13.0, 36.0, 14):
            for flow in np.linspace(0.3, 26.0, 13):
                for p in (8.2, 10.2, 14.7):
                    status = twin.evaluate_state(mat, float(o2), float(flow), p)["regime"]
                    samples.append({
                        "text": _prompt_for(mat, 2.5, float(flow), float(o2), p),
                        "label": LABEL2ID[status], "status": status,
                        "material": mat, "o2": float(o2), "flow": float(flow), "pressure": p,
                    })

    return pd.DataFrame(samples)

class MicrogravityDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_len=128):
        self.texts = texts
        self.labels = labels
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        text = str(self.texts[idx])
        label = int(self.labels[idx])
        encoding = self.tokenizer(
            text,
            truncation=True,
            padding="max_length",
            max_length=self.max_len,
            return_tensors="pt"
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(0),
            "attention_mask": encoding["attention_mask"].squeeze(0),
            "labels": torch.tensor(label, dtype=torch.long)
        }

def train_fine_tuned_model():
    print("=" * 70)
    print("🚀 Commencing Fine-Tuning of Qwen-0.6B on NASA Microgravity Combustion")
    print("=" * 70)
    
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Hardware Acceleration Device: {device.upper()}")
    
    # 1. Load Tokenizer
    print("\nLoading Qwen Tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL_PATH)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        
    # 2. Build Dataset
    print("Preparing dataset with physics-guided representations...")
    df_data = generate_augmented_training_samples()
    print(f"Total structured combustion examples: {len(df_data)}")
    print("Class distribution:", df_data["status"].value_counts().to_dict())
    
    # Stratified Train/Val/Test Split
    train_df, test_df = train_test_split(
        df_data, test_size=0.20, random_state=42, stratify=df_data["label"]
    )
    train_df, val_df = train_test_split(
        train_df, test_size=0.15, random_state=42, stratify=train_df["label"]
    )
    
    print(f"Train set: {len(train_df)}, Val set: {len(val_df)}, Test set: {len(test_df)}")
    
    train_dataset = MicrogravityDataset(train_df["text"].tolist(), train_df["label"].tolist(), tokenizer)
    val_dataset = MicrogravityDataset(val_df["text"].tolist(), val_df["label"].tolist(), tokenizer)
    test_dataset = MicrogravityDataset(test_df["text"].tolist(), test_df["label"].tolist(), tokenizer)
    
    train_loader = DataLoader(train_dataset, batch_size=8, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=8, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=8, shuffle=False)
    
    # 3. Load Model & Apply LoRA
    print("\nLoading Qwen3ForSequenceClassification and configuring LoRA PEFT...")
    base_model = AutoModelForSequenceClassification.from_pretrained(
        BASE_MODEL_PATH,
        num_labels=3,
        id2label=ID2LABEL,
        label2id=LABEL2ID
    )
    base_model.config.pad_token_id = tokenizer.pad_token_id
    
    peft_config = LoraConfig(
        task_type=TaskType.SEQ_CLS,
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]
    )
    model = get_peft_model(base_model, peft_config)
    model.print_trainable_parameters()
    model.to(device)
    
    # 4. Training Hyperparameters
    epochs = 8
    counts = np.bincount(train_df["label"].to_numpy(), minlength=3).astype(np.float32)
    class_weights = torch.tensor(counts.sum() / (3.0 * np.maximum(counts, 1.0)), dtype=torch.float32, device=device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=0.01)
    total_steps = len(train_loader) * epochs
    scheduler = get_cosine_schedule_with_warmup(optimizer, num_warmup_steps=int(0.1*total_steps), num_training_steps=total_steps)

    best_val_f1 = -1.0
    best_state_dict = None
    patience, stale_epochs = 4, 0
    training_history = []

    print("\nStarting Training Loop...")
    for epoch in range(1, epochs + 1):
        model.train()
        total_train_loss = 0.0

        for batch in train_loader:
            optimizer.zero_grad()
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            loss = torch.nn.functional.cross_entropy(outputs.logits.float(), labels, weight=class_weights)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            total_train_loss += loss.item()
            
        avg_train_loss = total_train_loss / len(train_loader)
        
        # Validation
        model.eval()
        val_preds, val_targets = [], []
        with torch.no_grad():
            for batch in val_loader:
                input_ids = batch["input_ids"].to(device)
                attention_mask = batch["attention_mask"].to(device)
                labels = batch["labels"].to(device)
                
                outputs = model(input_ids=input_ids, attention_mask=attention_mask)
                preds = torch.argmax(outputs.logits, dim=-1).cpu().numpy()
                val_preds.extend(preds)
                val_targets.extend(labels.cpu().numpy())
                
        val_acc = accuracy_score(val_targets, val_preds)
        val_f1 = f1_score(val_targets, val_preds, average="macro")
        
        print(f"Epoch {epoch:2d}/{epochs:2d} | Train Loss: {avg_train_loss:.4f} | Val Acc: {val_acc*100:.1f}% | Val F1: {val_f1*100:.1f}%")
        training_history.append({
            "epoch": epoch,
            "train_loss": avg_train_loss,
            "val_accuracy": val_acc,
            "val_f1": val_f1
        })
        
        if val_f1 > best_val_f1:
            best_val_f1 = val_f1
            best_state_dict = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                print(f"Early stopping at epoch {epoch} (no val F1 improvement for {patience} epochs).")
                break

    # 5. Holdout Test Set Evaluation
    print("\n=== Evaluating Best Checkpoint on Holdout Test Set ===")
    if best_state_dict is not None:
        model.load_state_dict(best_state_dict)
        
    model.eval()
    test_preds, test_targets = [], []
    with torch.no_grad():
        for batch in test_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)
            
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            preds = torch.argmax(outputs.logits, dim=-1).cpu().numpy()
            test_preds.extend(preds)
            test_targets.extend(labels.cpu().numpy())
            
    test_acc = accuracy_score(test_targets, test_preds)
    test_f1 = f1_score(test_targets, test_preds, average="macro")
    print(f"Test Accuracy: {test_acc*100:.2f}% | Test Macro F1: {test_f1*100:.2f}%")
    
    target_names = [ID2LABEL[i] for i in range(3)]
    report = classification_report(test_targets, test_preds, target_names=target_names, output_dict=True)
    print("\nClassification Report:")
    print(classification_report(test_targets, test_preds, target_names=target_names))
    
    cm = confusion_matrix(test_targets, test_preds)
    
    # 6. Save Fine-Tuned Model & Artifacts
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Saving fine-tuned model and adapter weights to {OUTPUT_DIR}/...")
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    
    metrics_export = {
        "model_name": "Fine-Tuned Qwen-0.6B LoRA Flammability Classifier",
        "base_model": "Qwen/Qwen3-0.6B",
        "task": "Microgravity Flame-Spread Regime Prediction",
        "device": device,
        "epochs": epochs,
        "label_source": "physics-reconciled flight records + digital-twin-labeled grid",
        "best_val_macro_f1": round(float(best_val_f1), 4),
        "test_accuracy": round(float(test_acc), 4),
        "test_macro_f1": round(float(test_f1), 4),
        "classes": target_names,
        "confusion_matrix": cm.tolist(),
        "classification_report": report,
        "training_history": training_history
    }
    
    with open(os.path.join(OUTPUT_DIR, "evaluation_metrics.json"), "w") as f:
        json.dump(metrics_export, f, indent=2)
    with open("rag/transformer_model_metrics.json", "w") as f:
        json.dump(metrics_export, f, indent=2)
        
    print(f"✅ Fine-Tuning Complete! Saved model to {OUTPUT_DIR}")
    return model, tokenizer, metrics_export

if __name__ == "__main__":
    train_fine_tuned_model()

