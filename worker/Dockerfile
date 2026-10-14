FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf-cache

WORKDIR /app

# CPU-only PyTorch: ~200 MB instead of ~2.5 GB with CUDA.
RUN pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt

# Download the model at build time so containers start fast and work offline.
ARG MODEL_NAME=distilbert-base-uncased-finetuned-sst-2-english
RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification as M; \
AutoTokenizer.from_pretrained('${MODEL_NAME}'); M.from_pretrained('${MODEL_NAME}')"
ENV HF_HUB_OFFLINE=1

COPY inference_worker ./inference_worker
RUN useradd --create-home app && chown -R app /opt/hf-cache
USER app
CMD ["python", "-m", "inference_worker"]
