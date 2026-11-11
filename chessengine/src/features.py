
import numpy as np
import chess


INPUT_FEATURES = 1024

PIECE_FEATURES = 12 * 64

CASTLING_OFFSET = 768
EN_PASSANT_OFFSET = 772
SIDE_TO_MOVE_OFFSET = 836
HALFMOVE_OFFSET = 837


def encode_perspective(board, perspective):

    features = np.zeros(INPUT_FEATURES, dtype=np.float32)

    # 1. Encode pieces
    for square, piece in board.piece_map().items():

        # Determine relative ownership
        if piece.color == perspective:
            color_offset = 0
        else:
            color_offset = 6

        piece_index = piece.piece_type - 1

        # Flip ranks for Black's perspective
        oriented_square = square

        if perspective == chess.BLACK:
            oriented_square ^= 56

        feature_index = (
            (color_offset + piece_index) * 64
            + oriented_square
        )

        features[feature_index] = 1.0

    # 2. Encode castling rights
    opponent = not perspective

    castling = [
        board.has_kingside_castling_rights(perspective),
        board.has_queenside_castling_rights(perspective),
        board.has_kingside_castling_rights(opponent),
        board.has_queenside_castling_rights(opponent)
    ]

    for i, available in enumerate(castling):

        features[CASTLING_OFFSET + i] = float(available)

    # 3. Encode en passant square
    if board.ep_square is not None:

        ep_square = board.ep_square

        if perspective == chess.BLACK:
            ep_square ^= 56

        features[EN_PASSANT_OFFSET + ep_square] = 1.0

    # 4. Encode side to move relative to perspective
    features[SIDE_TO_MOVE_OFFSET] = float(
        board.turn == perspective
    )

    # 5. Encode halfmove clock
    features[HALFMOVE_OFFSET] = min(
        board.halfmove_clock / 100.0,
        1.0
    )

    return features


def encode_position(fen):

    board = chess.Board(fen)

    white_features = encode_perspective(
        board,
        chess.WHITE
    )

    black_features = encode_perspective(
        board,
        chess.BLACK
    )

    return np.stack([
        white_features,
        black_features
    ])


if __name__ == "__main__":

    board = chess.Board()

    features = encode_position(board.fen())

    print("Encoded shape:", features.shape)
    print("Data type:", features.dtype)

    print(
        "White perspective active features:",
        np.count_nonzero(features[0])
    )

    print(
        "Black perspective active features:",
        np.count_nonzero(features[1])
    )

    print("Encoding successful!")
