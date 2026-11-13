# CHESS-IQ

### AI-Powered Chess Analysis, Playing and Coaching Platform

**CHESS-IQ** is a full-stack chess platform combining a custom-trained
neural position evaluator, an independently implemented chess search
algorithm, conventional Stockfish analysis, and an LLM-powered chess
coach.

[Live Application](https://chessiq-hazel.vercel.app/) · [GitHub
Repository](https://github.com/Sarthak3846/chessiq)

## 1. Project Overview

CHESS-IQ helps players play chess, analyze games, solve puzzles, explore
openings, and understand their decisions through AI coaching. Its
central engineering component is a custom chess engine: we designed the
position encoder, trained and compared multiple neural-network
configurations, implemented minimax search with alpha-beta pruning, and
built a separate API for serving the engine.

The platform is composed of three application services:

  -----------------------------------------------------------------------
  Service                 Stack                   Responsibility
  ----------------------- ----------------------- -----------------------
  Frontend                React, TypeScript, Vite Interface, chessboard,
                                                  routing, auth state and
                                                  API clients

  Main backend            Python, FastAPI         Accounts, games,
                                                  puzzles, Stockfish
                                                  analysis and AI Coach

  Custom engine           Python, FastAPI, NumPy  Neural evaluation,
                                                  search and move
                                                  selection
  -----------------------------------------------------------------------

Supporting services include Supabase Auth and PostgreSQL, Google OAuth,
Groq and Gemini APIs, and Stockfish. The frontend is deployed on Vercel.
The backend and engine are independently containerized for deployment;
their exact production URLs are configured through environment
variables.

## 2. System Architecture

The frontend communicates with the main backend and custom engine
through separate HTTP API clients. It uses Supabase directly for
authentication, but does not connect directly to PostgreSQL or expose
private LLM credentials.

``` mermaid
flowchart TD
    U["User"] --> FE["React Frontend on Vercel"]
    FE --> SA["Supabase Auth"]
    SA <--> GO["Google OAuth"]
    FE --> MB["Main FastAPI Backend"]
    FE --> CE["Custom Engine FastAPI"]
    MB --> DB[("Supabase PostgreSQL")]
    MB --> SF["Stockfish"]
    MB --> LLM["LLM Provider Router"]
    LLM --> GQ["Groq API"]
    LLM --> GM["Gemini API"]
    CE --> SEARCH["ChessIQ Search"]
    SEARCH --> EVAL["Neural Evaluator"]
    EVAL --> NP["NumPy Model Inference"]
```

## 3. Frontend

The frontend uses React 18, TypeScript 5, Vite 5, Tailwind CSS 3, React
Router 6, Zustand 5, Supabase JS, chess.js, Stockfish WebAssembly,
Framer Motion and Recharts.

It is deployed on Vercel:
[chessiq-hazel.vercel.app](https://chessiq-hazel.vercel.app/).

Two API clients keep the services separate:

-   `src/lib/api.ts` communicates with the main backend for profiles,
    games, statistics, puzzles and coaching.
-   `src/lib/engineApi.ts` communicates with the custom engine for
    health checks and move requests.

Their base URLs are configured through `VITE_API_BASE_URL` and
`VITE_ENGINE_API_URL`. The engine client uses `http://localhost:8001` as
its local-development default.

The main routes are `/`, `/play`, `/play-coach`, `/login`, `/profile`,
`/coach`, `/puzzles`, `/openings` and `/analysis`. `src/main.tsx` mounts
the application inside `BrowserRouter` and `AuthProvider`. The auth
provider maintains the Supabase session, current user, profile and
loading state; Zustand manages other application state.

## 4. Authentication and User Identity

Authentication uses **Supabase Auth with Google OAuth**. We do not
implement Google's OAuth protocol ourselves. The frontend calls
Supabase's `signInWithOAuth`; Supabase manages the Google redirect,
callback and token exchange.

The flow is:

``` mermaid
sequenceDiagram
    actor User
    participant App as React Frontend
    participant Supabase as Supabase Auth
    participant Google
    participant API as Main FastAPI Backend
    participant DB as PostgreSQL

    User->>App: Select Continue with Google
    App->>Supabase: Start Google OAuth
    Supabase->>Google: Redirect for account selection
    Google-->>Supabase: OAuth callback
    Supabase-->>App: Return authenticated session
    App->>API: Request with Bearer access token
    API->>API: Verify JWT signature and claims
    API->>DB: Retrieve or create profile
    DB-->>API: Profile
    API-->>App: Authenticated profile
```

The Supabase client is initialized in `src/lib/supabase.ts` using
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It enables session
persistence, automatic token refresh and callback detection. The OAuth
redirect is configured to return users to `/profile`.

The backend independently verifies access tokens in
`backend/app/auth.py`. It checks the signature, expiration, subject,
audience, role and supported signing algorithm. The implementation
supports HS256 and asymmetric verification through Supabase JWKS,
including ES256, RS256 and EdDSA. It derives the user ID from the
verified `sub` claim rather than trusting an ID supplied by the browser.

The backend exposes two auth dependencies: `optional_user` permits
anonymous access where supported while still validating supplied tokens;
`current_user` requires authentication.

Supabase Auth stores identity records in `auth.users`.
Application-specific data is stored separately in `public.profiles`. A
database trigger creates a profile for new users, and the backend's
`ensure_profile()` function provides an additional safeguard. PostgreSQL
Row Level Security and backend user-ID checks restrict access to
user-owned records.

Frontend environment variables contain only the public Supabase URL and
anon/publishable key. Service-role keys and other private secrets belong
only in backend environment variables.

## 5. Main Application Backend

The main backend lives in `backend/` and is a Python 3.11 FastAPI
application served by Uvicorn. It uses Pydantic 2 for validation,
psycopg 3 and psycopg-pool for PostgreSQL access, PyJWT for token
verification, HTTPX for external APIs, python-chess for chess data, and
Docker for containerization.

Its main modules are:

  -----------------------------------------------------------------------
  File                                Responsibility
  ----------------------------------- -----------------------------------
  `main.py`                           FastAPI setup, lifecycle,
                                      middleware and route registration

  `auth.py`                           Supabase JWT verification

  `config.py`                         Environment configuration

  `db.py`                             PostgreSQL connection pool

  `engine.py`                         Stockfish process management

  `analysis.py`                       Chess analysis and game-review
                                      facts

  `prompts.py`                        Coach prompt construction

  `routes_account.py`                 Profiles, saved games and
                                      statistics

  `routes_puzzles.py`                 Puzzle retrieval and attempt
                                      recording

  `routes_coach.py`                   Coaching conversations and streamed
                                      responses

  `llm/`                              Provider abstraction, routing, Groq
                                      and Gemini clients

  `sql/schema.sql`                    Database schema and security
                                      policies
  -----------------------------------------------------------------------

The application opens its database pool during startup and closes it
during shutdown. The configured pool range is 1 to 8 connections. The
backend also manages the lifecycle of its Stockfish processes.

## 6. Database

The application uses Supabase PostgreSQL. The schema includes:

-   `profiles`: application profile and player preferences.
-   `games`: saved games, PGN and optional analysis data.
-   `puzzles`: puzzle records.
-   `puzzle_attempts`: user puzzle attempts.
-   `conversations`: AI Coach conversations.
-   `messages`: conversation messages, facts and provider metadata.

Row Level Security is enabled. User-owned records are restricted to
their owners, while puzzle records are publicly readable under the
configured policies.

## 7. Stockfish Integration

Stockfish and the custom CHESS-IQ engine are separate systems. Stockfish
is used for conventional analysis and browser-based chess play; the
custom engine uses our own neural evaluator and search implementation.

The frontend includes Stockfish 19 WebAssembly. The main backend
launches Stockfish through the UCI interface using `python-chess`. It
maintains separate long-lived instances for interactive analysis and
background game reviews, preventing a lengthy review from blocking
interactive requests. Access to each process is synchronized.

Stockfish provides reference evaluations, candidate moves, principal
variations and game-review information. It is also used by the AI Coach
to obtain reliable chess facts. The custom engine does not call
Stockfish to choose its production moves.

## 8. AI Chess Coach

The AI Coach runs inside the main backend. It combines chess-engine
analysis with language-model generation instead of asking an LLM to
independently calculate a position.

The backend extracts context such as the current FEN, selected move, PGN
and relevant player information. Stockfish analyzes the position and
produces structured facts, such as evaluation, best move, continuation
and move quality. The backend incorporates these facts into a prompt,
then sends it to the configured LLM provider. The model turns the
analysis into an explanation the player can understand.

The provider abstraction is in `backend/app/llm/`:

-   `base.py` defines the provider interface.
-   `router.py` selects providers and manages fallback.
-   `groq.py` integrates Groq.
-   `gemini.py` integrates Gemini.

The configured Groq model is `llama-3.3-70b-versatile`; the configured
Gemini model is `gemini-2.5-flash`. The default provider order is
`groq,gemini`, configurable through `LLM_PROVIDER_ORDER`. The router
checks configuration and cooldown status and can fall back if a provider
fails before producing output. It does not splice a second provider's
response into a stream that has already started.

Coach responses are streamed to the frontend using Server-Sent Events.
Event types include `analysis`, `meta`, `token`, `warning`, `error` and
`done`. Authenticated conversations and messages can be persisted in
PostgreSQL, including message role, content, structured chess facts and
provider metadata.

## 9. Custom CHESS-IQ Engine

The custom engine is an independent Python service in `chessengine/`.
Its major stages are position encoding, neural evaluation, chess search
and API response. Its stack includes Python, PyTorch, NumPy,
python-chess, FastAPI, Pydantic, Uvicorn, Docker and
`ThreadPoolExecutor`.

The main source files are:

-   `src/features.py`: converts board positions into model features.
-   `src/model.py`: defines the neural network.
-   `src/dataset.py` and `src/build_dataset.py`: prepare training data.
-   `src/train.py` and `src/evaluate.py`: train and validate models.
-   `src/engine/evaluator.py`: connects the model to search.
-   `src/engine/search.py`: implements move search.
-   `src/engine/uci.py`: provides a UCI interface.
-   `api/`: contains the FastAPI service, request schemas, runtime
    settings and NumPy evaluator.

### 9.1 Position Encoding

A chessboard is converted into numerical features by `src/features.py`.
The encoder creates two perspectives, one for each player, with 1,024
features per perspective. The resulting `(2, 1024)` representation is
flattened into 2,048 model inputs.

  Feature group                   Features per perspective
  ----------------------------- --------------------------
  12 piece types × 64 squares                          768
  Castling rights                                        4
  En passant square                                     64
  Side to move                                           1
  Halfmove clock                                         1
  Reserved, currently unused                           186
  **Total**                                      **1,024**

Piece-square features are binary. The encoder uses relative ownership
channels, so friendly and opposing pieces occupy consistent channel
groups. For Black's perspective, ranks are flipped using `square ^ 56`.
Castling rights are represented by four flags, en passant by a
64-element one-hot vector, and the halfmove clock is normalized by
dividing by 100 and clipping at 1.

There are 838 currently defined feature slots; the remaining 186 are
zero-filled reserved slots. The fixed size leaves room for future
feature additions without changing the model input dimension.

### 9.2 Neural Network Architecture

We tested six configurations and selected **D-Square**, a compact
feed-forward, NNUE-inspired network. It is our own implementation and
should not be described as identical to Stockfish's optimized NNUE
architecture.

``` text
Input: 2048
   |
Linear: 2048 -> 128
   |
Squared Clipped ReLU
   |
Linear: 128 -> 64
   |
Clipped ReLU
   |
Linear: 64 -> 32
   |
Clipped ReLU
   |
Linear: 32 -> 1
   |
Single position evaluation
```

The model has four fully connected linear layers, three hidden layers
and **272,641 trainable parameters**.

  Layer         Dimensions Activation
  ---------- ------------- ----------------------
  Input              2,048 None
  Linear 1     2,048 → 128 Squared Clipped ReLU
  Linear 2        128 → 64 Clipped ReLU
  Linear 3         64 → 32 Clipped ReLU
  Linear 4          32 → 1 None

The parameter count includes biases:
`(2048×128+128) + (128×64+64) + (64×32+32) + (32×1+1) = 272,641`.

The two activation functions are:

-   Clipped ReLU: `clamp(x, 0, 1)`.
-   Squared Clipped ReLU: `clamp(x, 0, 1)²`.

The first hidden layer uses the squared activation; the next two use
standard clipped ReLU. The model is implemented in
`chessengine/src/model.py`.

### 9.3 Architecture Experiments

The final architecture was selected by comparing validation results:

  Model        Architecture                 Validation MAE   Correlation
  ------------ -------------------------- ---------------- -------------
  A            2048 → 8 → 32 → 1                    1.7330        0.7747
  B            2048 → 32 → 32 → 1                   1.6600        0.7927
  C            2048 → 64 → 32 → 1                   1.6098        0.8030
  C-Extended   2048 → 64 → 32 → 1                   1.5104        0.8180
  D            2048 → 128 → 64 → 32 → 1             1.4639        0.8223
  D-Square     2048 → 128 → 64 → 32 → 1         **1.4585**    **0.8236**

C-Extended used the same dimensions as C with an extended training
configuration. D-Square retained D's dimensions but changed the first
activation. It achieved the lowest recorded validation MAE.

MAE measures average absolute prediction error in pawns; correlation
measures association with reference evaluations. These are
evaluation-prediction metrics, not playing-strength metrics. We have not
established an Elo rating for the custom engine.

### 9.4 Dataset Preparation

The data pipeline converts PGN games into labelled positions. The
recorded extraction configuration used an original corpus of
approximately 4,193,152 games, sampled 200,000 games with seed 42,
skipped the first 20 plies and sampled every 8 plies.

Using python-chess, the pipeline reconstructs positions, extracts FENs,
filters terminal positions, deduplicates records and stores intermediate
data. The extracted dataset contained:

  Position type                     Count
  --------------------------- -----------
  Total extracted positions     1,465,040
  Centipawn-evaluated           1,441,705
  Mate-evaluated                   23,335

Mate-scored positions were excluded from regression training. Centipawn
targets were converted to pawns by dividing by 100.

The dataset was split by game ID, rather than by individual position, to
reduce overlap between positions from the same game:

  Split              Positions
  ------------ ---------------
  Training           1,296,470
  Validation           145,235
  **Total**      **1,441,705**

Encoded features are stored in `(N, 2, 1024)` NumPy arrays and loaded
using memory mapping to reduce RAM usage.

### 9.5 Training

Training is implemented with PyTorch. The recorded configuration uses
AdamW, Smooth L1 loss, ReduceLROnPlateau and early stopping.

  Parameter                         Value
  ---------------------------- ----------
  Initial learning rate             0.001
  Weight decay                    0.00001
  Batch size                        1,024
  Maximum epochs                       20
  Early-stopping patience               4
  Scheduler patience                    2
  Scheduler reduction factor          0.5
  Minimum learning rate          0.000001
  Random seed                          42

Training uses CUDA when available and falls back to CPU otherwise.

### 9.6 Search Algorithm

The neural network evaluates a position; it does not by itself choose a
move. `chessengine/src/engine/search.py` implements `ChessIQSearch`,
which explores legal continuations and uses the network to evaluate
positions.

The search includes:

-   **Minimax:** White maximizes the white-perspective score and Black
    minimizes it.
-   **Alpha-beta pruning:** removes branches that cannot affect the
    minimax result at the searched depth.
-   **Iterative deepening:** searches progressively deeper, retaining
    the best completed result.
-   **Quiescence search:** extends unstable leaf positions through
    captures, promotions and legal evasions when in check; maximum
    quiescence depth is 12.
-   **Move ordering:** prioritizes captures using victim and attacker
    values, promotions and the transposition-table move.
-   **Transposition table:** caches depth, score, bound type and best
    move, keyed by FEN. Supported bound types are `EXACT`, `LOWER` and
    `UPPER`.
-   **Terminal handling:** recognizes checkmate and draw conditions
    supplied by python-chess. The mate score is 10,000 and is adjusted
    by ply to prefer faster wins and slower losses.

We implemented the neural evaluator and search algorithm. `python-chess`
supplies board representation, FEN parsing, legal move generation, move
application and reversal, check and checkmate detection, draw-rule
handling, and SAN/UCI move representation. Therefore, this is a custom
evaluator and search engine built on an established chess-rules library,
not a complete low-level reimplementation of every chess-engine
component.

### 9.7 UCI Interface

The engine includes `chessengine/src/engine/uci.py`, which implements
the Universal Chess Interface protocol. It supports commands such as
`uci`, `isready`, `ucinewgame`, `position startpos`, `position fen`,
`go depth`, `stop` and `quit`. This allows the engine to be tested
independently of the React application and integrated with compatible
chess GUIs.

### 9.8 PyTorch-to-NumPy Production Inference

PyTorch is used for model training, but production inference uses a
separate NumPy implementation. This avoids installing the full PyTorch
framework just to run a small feed-forward network.

The trained model is exported to `model_d_square.npz`. The archive
contains the four linear layers' weights and biases (`w0`/`b0` through
`w3`/`b3`). The NumPy evaluator reproduces the network's linear
operations and activation functions for production use.
