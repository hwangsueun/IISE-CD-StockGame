# Build from the repository root: docker build -f server/Dockerfile .
FROM node:20-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY quant/runtime-requirements.txt quant/workshop-requirements.txt quant/explain-requirements.txt ./quant/
RUN python3 -m venv /opt/antsurvival-models \
    && /opt/antsurvival-models/bin/python -m pip install --no-cache-dir -r quant/runtime-requirements.txt
ENV USER_STRATEGY_PYTHON=/opt/antsurvival-models/bin/python \
    QUANT_EXPLAIN_PYTHON=/opt/antsurvival-models/bin/python \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY quant/check_runtime.py quant/explain.py /app/quant/
RUN /opt/antsurvival-models/bin/python /app/quant/check_runtime.py --require-all
EXPOSE 3001
CMD ["node", "src/index.js"]
