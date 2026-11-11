
import torch
import torch.nn as nn

from src.config import INPUT_FEATURES, NUM_PERSPECTIVES, OUTPUT_SIZE


class ClippedReLU(nn.Module):
    def forward(self, x):
        return torch.clamp(x, min=0.0, max=1.0)


class SqrClippedReLU(nn.Module):
    def forward(self, x):
        return torch.clamp(x, min=0.0, max=1.0).square()


class ChessIQNNUE(nn.Module):

    def __init__(
        self,
        hidden_1=64,
        hidden_2=32,
        hidden_3=None,
        use_sqr_activation=False
    ):
        super().__init__()

        input_size = INPUT_FEATURES * NUM_PERSPECTIVES

        layers = [
            nn.Linear(input_size, hidden_1),
            SqrClippedReLU() if use_sqr_activation else ClippedReLU()
        ]

        if hidden_3 is not None:
            layers.extend([
                nn.Linear(hidden_1, hidden_2),
                ClippedReLU(),
                nn.Linear(hidden_2, hidden_3),
                ClippedReLU()
            ])
            final_size = hidden_3
        else:
            layers.extend([
                nn.Linear(hidden_1, hidden_2),
                ClippedReLU()
            ])
            final_size = hidden_2

        layers.append(nn.Linear(final_size, OUTPUT_SIZE))

        self.network = nn.Sequential(*layers)

    def forward(self, x):
        x = x.reshape(x.shape[0], -1)
        return self.network(x)


if __name__ == "__main__":

    model = ChessIQNNUE(
        hidden_1=128,
        hidden_2=64,
        hidden_3=32
    )

    sample = torch.randn(16, 2, 1024)
    output = model(sample)

    parameters = sum(p.numel() for p in model.parameters())

    print(model)
    print("Input:", sample.shape)
    print("Output:", output.shape)
    print("Parameters:", parameters)
