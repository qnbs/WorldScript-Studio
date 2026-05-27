#!/usr/bin/env python3
"""
StoryCraft Studio — LoRA Environment Pre-flight Check
Emits a JSON report to stdout. Called by the Tauri check_lora_environment command.
"""

import json
import subprocess
import sys


def check_python_version() -> str:
    v = sys.version_info
    return f"{v.major}.{v.minor}.{v.micro}"


def check_package(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def check_cuda_and_vram() -> tuple[bool, float]:
    try:
        import torch  # type: ignore[import]
        if not torch.cuda.is_available():
            # Check Apple MPS
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return True, 0.0  # MPS — can't query VRAM easily
            return False, 0.0
        props = torch.cuda.get_device_properties(0)
        vram_gb = round(props.total_memory / 1024**3, 1)
        return True, vram_gb
    except Exception:
        return False, 0.0


def main() -> None:
    python_version = check_python_version()
    unsloth_ok = check_package("unsloth")
    peft_ok = check_package("peft")
    torch_ok = check_package("torch")
    cuda_ok, vram_gb = check_cuda_and_vram()

    report = {
        "python_available": True,
        "python_version": python_version,
        "unsloth_available": unsloth_ok and peft_ok and torch_ok,
        "cuda_available": cuda_ok,
        "vram_gb": vram_gb,
    }
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
