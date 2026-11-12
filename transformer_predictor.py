#!/usr/bin/env python3
"""
Inference wrapper for the Fine-Tuned Qwen-0.6B Microgravity Flammability Model.
Loads LoRA adapter weights and runs real-time inference on Apple Silicon MPS or CPU.
"""

import os
import json
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from peft import PeftModel

BASE_MODEL_PATH = os.environ.get("SHUNNO_BASE_MODEL", "Qwen/Qwen3-0.6B")
ADAPTER_PATH = "models/fine_tuned_qwen_flammability"

ID2LABEL = {0: "Sustained Burn", 1: "Radiative Extinction", 2: "Blowoff"}

class FineTunedQwenPredictor:
    def __init__(self, adapter_path=ADAPTER_PATH, base_path=BASE_MODEL_PATH):
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.adapter_path = adapter_path
        self.base_path = base_path
        
        self.tokenizer = AutoTokenizer.from_pretrained(base_path)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
            
        base_model = AutoModelForSequenceClassification.from_pretrained(
            base_path,
            num_labels=3,
            id2label=ID2LABEL
        )
        base_model.config.pad_token_id = self.tokenizer.pad_token_id
        
        if os.path.exists(adapter_path):
            self.model = PeftModel.from_pretrained(base_model, adapter_path)
        else:
            self.model = base_model
            
        self.model.to(self.device)
        self.model.eval()

    def predict(self, material, o2_pct, flow_cms, pressure_psi=14.7, thickness_mm=2.5):
        da = (o2_pct / 21.0) / (1.0 + (flow_cms / 6.0)**1.5)
        rad = 1.0 / (max(0.2, flow_cms) * max(0.1, o2_pct / 21.0))
        
        prompt = (f"NASA Microgravity Combustion Mission. Material: {material}. "
                  f"Fuel Thickness: {thickness_mm:.1f} mm. Forced Airflow Velocity: {flow_cms:.1f} cm/s. "
                  f"Oxygen Concentration: {o2_pct:.1f}% O2. Cabin Pressure: {pressure_psi:.1f} psi. "
                  f"Damköhler Reaction Proxy: {da:.2f}. Radiative Loss Index: {rad:.2f}. "
                  f"Gravity: Microgravity (0 g, absence of natural buoyant updraft). "
                  f"What is the flame-spread flammability regime?")

        inputs = self.tokenizer(
            prompt,
            truncation=True,
            padding=True,
            max_length=128,
            return_tensors="pt"
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits.squeeze(0).float()
            probs = torch.softmax(logits, dim=-1).cpu().numpy()
            pred_id = int(torch.argmax(logits).item())
            
        pred_regime = ID2LABEL[pred_id]

        # Honest physics cross-check: report disagreement with the LOC boundary
        # instead of silently overwriting the model's prediction.
        loi = 17.5 if material == "PMMA" else (26.0 if material == "Nomex" else 16.8)
        physics_consistent = not (o2_pct < loi - 0.5 and pred_regime == "Sustained Burn")

        return {
            "model_type": "Fine-Tuned Qwen-0.6B (LoRA Transformer)",
            "predicted_regime": pred_regime,
            "probabilities": {ID2LABEL[i]: float(probs[i]) for i in range(3)},
            "physics_consistent": physics_consistent,
            "limiting_oxygen_index": loi,
            "inputs": {
                "material": material,
                "O2_concentration_pct": float(o2_pct),
                "airflow_velocity_cms": float(flow_cms),
                "cabin_pressure_psi": float(pressure_psi),
                "sample_thickness_mm": float(thickness_mm)
            },
            "prompt": prompt
        }

if __name__ == "__main__":
    print("Testing Fine-Tuned Qwen Predictor...")
    predictor = FineTunedQwenPredictor()
    
    print("\n--- Condition 1: 21% O2 ---")
    p21 = predictor.predict("PMMA", 21.0, 7.5, 14.7, 2.5)
    print("Regime:", p21["predicted_regime"])
    print("Probabilities:", p21["probabilities"])
    
    print("\n--- Condition 2: 17% O2 (Killer Demo) ---")
    p17 = predictor.predict("PMMA", 17.0, 7.5, 14.7, 2.5)
    print("Regime:", p17["predicted_regime"])
    print("Probabilities:", p17["probabilities"])
