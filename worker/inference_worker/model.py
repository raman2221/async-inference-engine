"""Model backends. Both expose `predict(texts) -> list[Prediction]` and are
called with a whole batch at once, which is the point of the project: one
forward pass over 16 inputs costs far less than 16 forward passes over 1.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class Prediction:
    label: str
    score: float


class Model(Protocol):
    name: str

    def predict(self, texts: list[str]) -> list[Prediction]: ...


class HFSentimentModel:
    """DistilBERT fine-tuned on SST-2 (positive/negative sentiment), run with
    PyTorch on CPU. Small enough (~260 MB) to run anywhere, real enough that
    batching gives a measurable speed-up."""

    def __init__(self, model_name: str, max_length: int = 128, num_threads: int | None = None) -> None:
        # Imported lazily so tests and the fake backend don't need torch.
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        if num_threads:
            torch.set_num_threads(num_threads)
        self._torch = torch
        self.name = model_name
        self.max_length = max_length
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.eval()  # disable dropout: deterministic inference
        self.id2label = self.model.config.id2label

    def predict(self, texts: list[str]) -> list[Prediction]:
        # padding=True pads every sequence to the longest one in THIS batch,
        # producing one rectangular [batch, seq_len] tensor the model can
        # process in a single matrix multiply.
        encoded = self.tokenizer(
            texts, padding=True, truncation=True, max_length=self.max_length, return_tensors="pt"
        )
        with self._torch.inference_mode():  # no autograd bookkeeping
            logits = self.model(**encoded).logits
        probs = self._torch.softmax(logits, dim=-1).numpy()
        return _to_predictions(probs, self.id2label)


class FakeModel:
    """Simulates a model whose cost is `fixed_ms + per_item_ms * batch_size`.

    That shape is what makes batching pay off on real hardware: there is a
    fixed overhead per forward pass (kernel launches, Python dispatch, memory
    traffic for the weights) that gets shared across the batch. Used in tests
    and for running the pipeline without downloading a model."""

    name = "fake"
    LABELS = {0: "NEGATIVE", 1: "POSITIVE"}

    def __init__(self, fixed_ms: float = 20.0, per_item_ms: float = 2.0) -> None:
        self.fixed_ms = fixed_ms
        self.per_item_ms = per_item_ms

    def predict(self, texts: list[str]) -> list[Prediction]:
        time.sleep((self.fixed_ms + self.per_item_ms * len(texts)) / 1000.0)
        positive = np.array([0.9 if "good" in t.lower() or "great" in t.lower() else 0.2 for t in texts])
        probs = np.stack([1.0 - positive, positive], axis=1)
        return _to_predictions(probs, self.LABELS)


def _to_predictions(probs: np.ndarray, id2label: dict[int, str]) -> list[Prediction]:
    best = probs.argmax(axis=1)
    return [Prediction(label=id2label[int(i)], score=round(float(probs[row, i]), 4)) for row, i in enumerate(best)]


def load_model(backend: str, model_name: str, num_threads: int | None) -> Model:
    if backend == "fake":
        return FakeModel()
    if backend == "hf":
        return HFSentimentModel(model_name, num_threads=num_threads)
    raise ValueError(f"unknown MODEL_BACKEND {backend!r} (expected 'hf' or 'fake')")
