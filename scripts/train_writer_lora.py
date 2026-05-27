#!/usr/bin/env python3
"""
StoryCraft Studio — LoRA Fine-Tuning Script (v2.0)
Uses Unsloth + PEFT for privacy-first, offline writer-style personalization.

Requirements:
  pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
  pip install trl peft bitsandbytes datasets transformers torch

Usage:
  python scripts/train_writer_lora.py \\
    --model "unsloth/llama-3.2-7b-instruct-bnb-4bit" \\
    --dataset "./lora-dataset.jsonl" \\
    --output-dir "./lora-output" \\
    --preset "writer-style-light"

  # Merge adapter into base weights (produces merged GGUF):
  python scripts/train_writer_lora.py \\
    --merge --model "unsloth/llama-3.2-7b-instruct-bnb-4bit" \\
    --adapter "./lora-output/adapter" \\
    --output-dir "./lora-merged"
"""

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Preset definitions (must match TypeScript HYPERPARAM_PRESETS)
# ---------------------------------------------------------------------------

PRESETS: dict[str, dict] = {
    "writer-style-light": {
        "r": 8, "alpha": 16, "epochs": 1, "method": "dora",
        "max_seq": 512, "modules": ["q_proj", "v_proj"],
    },
    "deep-narrative": {
        "r": 16, "alpha": 32, "epochs": 2, "method": "rslora",
        "max_seq": 1024, "modules": "all-linear",
    },
    "dialogue-master": {
        "r": 8, "alpha": 16, "epochs": 2, "method": "dora",
        "max_seq": 256, "modules": ["q_proj", "k_proj", "v_proj"],
    },
    "full-style-clone": {
        "r": 32, "alpha": 64, "epochs": 3, "method": "dora",
        "max_seq": 2048, "modules": "all-linear",
    },
}

# ---------------------------------------------------------------------------
# Progress reporting (JSON lines to stdout — read by Tauri lora.rs)
# ---------------------------------------------------------------------------

def emit(event: str, **kwargs) -> None:
    print(json.dumps({"event": event, **kwargs}), flush=True)


# ---------------------------------------------------------------------------
# Environment pre-flight callback
# ---------------------------------------------------------------------------

class ProgressCallback:
    """Emits JSON progress events on each training log step."""

    def __init__(self, total_steps: int) -> None:
        self.total_steps = max(total_steps, 1)

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is None:
            return
        emit(
            "progress",
            epoch=round(state.epoch, 3),
            step=state.global_step,
            loss=logs.get("loss"),
            progress_percent=int(state.global_step / self.total_steps * 100),
        )


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train(args: argparse.Namespace) -> None:
    try:
        from unsloth import FastLanguageModel  # type: ignore[import]
        from trl import SFTTrainer  # type: ignore[import]
        from transformers import TrainingArguments  # type: ignore[import]
        from datasets import load_dataset  # type: ignore[import]
    except ImportError as exc:
        emit("error", message=f"Missing dependency: {exc}. Run: pip install unsloth trl peft bitsandbytes datasets transformers torch")
        sys.exit(1)

    cfg = PRESETS[args.preset]
    r: int = args.rank or cfg["r"]
    alpha: int = args.alpha or cfg["alpha"]
    epochs: int = args.epochs or cfg["epochs"]
    max_seq: int = args.max_seq_len or cfg["max_seq"]
    modules = cfg["modules"] if isinstance(cfg["modules"], list) else None

    emit("loading_model", model=args.model)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=max_seq,
        dtype=None,
        load_in_4bit=True,
    )

    use_dora = cfg["method"] == "dora"
    use_rslora = cfg["method"] == "rslora"

    model = FastLanguageModel.get_peft_model(
        model,
        r=r,
        lora_alpha=alpha,
        lora_dropout=0.05,
        target_modules=modules,
        use_dora=use_dora,
        use_rslora=use_rslora,
        bias="none",
        random_state=42,
    )

    dataset = load_dataset("json", data_files=args.dataset, split="train")
    emit("dataset_loaded", size=len(dataset))

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Estimate total steps for progress reporting
    batch_size = 2
    grad_acc = 4
    steps_per_epoch = max(1, len(dataset) // (batch_size * grad_acc))
    total_steps = steps_per_epoch * epochs

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="output",
        max_seq_length=max_seq,
        args=TrainingArguments(
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=grad_acc,
            warmup_steps=min(10, steps_per_epoch),
            num_train_epochs=epochs,
            learning_rate=2e-4,
            fp16=True,
            logging_steps=1,
            output_dir=str(output_dir / "checkpoints"),
            save_strategy="epoch",
            load_best_model_at_end=True,
            metric_for_best_model="loss",
            greater_is_better=False,
            report_to="none",
        ),
    )
    trainer.add_callback(ProgressCallback(total_steps=total_steps))
    trainer.train()

    adapter_path = output_dir / "adapter"
    model.save_pretrained(str(adapter_path))
    tokenizer.save_pretrained(str(adapter_path))

    # Export GGUF for Ollama (requires unsloth >= 2024.11)
    try:
        model.save_pretrained_gguf(str(output_dir / "adapter.gguf"), tokenizer)
        gguf_path = str(output_dir / "adapter.gguf")
    except Exception:
        gguf_path = ""

    emit("completed", adapter_path=str(adapter_path), gguf_path=gguf_path)


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def merge(args: argparse.Namespace) -> None:
    try:
        from unsloth import FastLanguageModel  # type: ignore[import]
    except ImportError as exc:
        emit("error", message=f"Missing dependency: {exc}")
        sys.exit(1)

    emit("loading_model", model=args.model)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=2048,
        dtype=None,
        load_in_4bit=True,
    )
    model.load_adapter(args.adapter)  # type: ignore[attr-defined]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained_merged(str(output_dir), tokenizer, save_method="merged_16bit")
    model.save_pretrained_gguf(str(output_dir / "merged.gguf"), tokenizer)
    emit("completed", adapter_path=str(output_dir), gguf_path=str(output_dir / "merged.gguf"))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="StoryCraft Studio — LoRA fine-tuning via Unsloth + PEFT"
    )
    parser.add_argument("--merge", action="store_true", help="Merge adapter into base weights")
    parser.add_argument("--model", required=True, help="HuggingFace model ID or local path")
    parser.add_argument("--dataset", help="Path to JSONL training dataset")
    parser.add_argument("--adapter", help="Path to LoRA adapter (for --merge)")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--preset", default="writer-style-light", choices=list(PRESETS.keys()))
    parser.add_argument("--rank", type=int)
    parser.add_argument("--alpha", type=int)
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--max-seq-len", type=int)
    args = parser.parse_args()

    if args.merge:
        if not args.adapter:
            emit("error", message="--adapter is required with --merge")
            sys.exit(1)
        merge(args)
    else:
        if not args.dataset:
            emit("error", message="--dataset is required for training")
            sys.exit(1)
        train(args)


if __name__ == "__main__":
    main()
