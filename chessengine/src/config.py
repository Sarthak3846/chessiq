
import torch

# Architecture
INPUT_FEATURES = 1024
NUM_PERSPECTIVES = 2
HIDDEN_1 = 8
HIDDEN_2 = 32
OUTPUT_SIZE = 1

# Training
BATCH_SIZE = 1024
EPOCHS = 20
LEARNING_RATE = 0.001
WEIGHT_DECAY = 1e-5

PATIENCE = 4
LR_PATIENCE = 2
LR_FACTOR = 0.5
MIN_LR = 1e-6

# Checkpoints
CHECKPOINT_DIR = "checkpoints"
BEST_MODEL_PATH = "checkpoints/best_nnue.pth"

# Reproducibility
SEED = 42

# Device
DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)
