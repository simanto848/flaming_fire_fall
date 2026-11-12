---
base_model: Qwen/Qwen3-0.6B
library_name: peft
pipeline_tag: text-classification
tags:
- microgravity
- combustion
- nasa-space-apps
- flammability
- lora
- transformers
- qwen
license: apache-2.0
language:
- en
metrics:
- accuracy
- f1
model-index:
- name: qwen-microgravity-flammability
  results:
  - task:
      type: text-classification
      name: Microgravity Flammability Regime Prediction
    dataset:
      name: NASA BASS-II & Saffire Microgravity Combustion Dataset
      type: combustion
    metrics:
    - type: accuracy
      value: 0.9971
      name: Test Accuracy
    - type: f1
      value: 0.9968
      name: Macro F1
---

# 🔥 Qwen-0.6B Microgravity Flammability Regime Classifier

A fine-tuned **Qwen-0.6B** sequence classification model using **LoRA (Low-Rank Adaptation)** for predicting spacecraft microgravity flame-spread regimes under varying environmental atmospheres.

Developed as part of the **NASA Space Apps Challenge · Flame in Freefall** (Project: *ShunnoShikha AI / Flaming Fire Fall*).

---

## 🛰️ Model Overview

In microgravity ($0\text{ g}$), buoyant natural convection is absent. Flame spread is governed by forced airflow velocity, oxygen concentration, fuel thickness, and cabin pressure, dividing combustion behavior into three critical regimes:

1. **Sustained Burn** (Class `0`): Steady or growing flame propagation.
2. **Radiative Extinction** (Class `1`): Low flow / thick fuel leading to excessive radiative heat loss that quenches the flame.
3. **Blowoff** (Class `2`): High forced airflow exceeding chemical reaction kinetics, blowing the flame off.

### Key Performance Metrics
* **Base Model:** `Qwen/Qwen3-0.6B`
* **Test Accuracy:** **99.71%**
* **Macro F1-Score:** **0.9968**
* **Target Classes:** `Sustained Burn`, `Radiative Extinction`, `Blowoff`

---

## 📊 Classification Report

| Regime | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Sustained Burn** | 0.988 | 1.000 | 0.994 | 85 |
| **Radiative Extinction** | 1.000 | 0.993 | 0.996 | 137 |
| **Blowoff** | 1.000 | 1.000 | 1.000 | 119 |
| **Overall Macro Avg** | **0.996** | **0.998** | **0.997** | 341 |

---

## 💻 How to Use in Python

```python
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from peft import PeftModel

MODEL_ID = "simanto848/qwen-microgravity-flammability"
BASE_MODEL = "Qwen/Qwen3-0.6B"

# 1. Load tokenizer and base model
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
base_model = AutoModelForSequenceClassification.from_pretrained(
    BASE_MODEL,
    num_labels=3,
    id2label={0: "Sustained Burn", 1: "Radiative Extinction", 2: "Blowoff"},
    label2id={"Sustained Burn": 0, "Radiative Extinction": 1, "Blowoff": 2}
)

# 2. Load LoRA adapter
model = PeftModel.from_pretrained(base_model, MODEL_ID)
model.eval()

# 3. Format mission prompt
prompt = (
    "NASA Microgravity Combustion Mission. Material: PMMA. "
    "Fuel Thickness: 2.5 mm. Forced Airflow Velocity: 5.0 cm/s. "
    "Oxygen Concentration: 21.0% O2. Cabin Pressure: 14.7 psi. "
    "Damköhler Reaction Proxy: 0.45. Radiative Loss Index: 1.00. "
    "Gravity: Microgravity (0 g, absence of natural buoyant updraft). "
    "What is the flame-spread flammability regime?"
)

inputs = tokenizer(prompt, return_tensors="pt")
with torch.no_grad():
    logits = model(**inputs).logits
    pred_id = torch.argmax(logits, dim=-1).item()
    probs = torch.softmax(logits, dim=-1)[0].tolist()

id2label = {0: "Sustained Burn", 1: "Radiative Extinction", 2: "Blowoff"}
print(f"Predicted Regime: {id2label[pred_id]}")
print(f"Probabilities: {probs}")
```

---

## 🔬 Dataset & Grounding
* Grounded in NASA Physical Science Informatics (PSI) flight records:
  * **BASS / BASS-II** (Burning and Suppression of Solids aboard the ISS)
  * **Saffire** (Spacecraft Fire Safety large-scale tests on Cygnus vehicles)
  * **FLEX** (Flame Extinction Experiment)
* Physics-reconciled labels ensure consistency with empirical Damköhler and Radiative loss extinction boundaries.
