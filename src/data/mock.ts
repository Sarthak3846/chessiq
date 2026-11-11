export const user = { name: 'Sarthak', streak: 12, games: 148, wins: 79, draws: 21, losses: 48, puzzleAccuracy: 78, puzzlesSolved: 612, avgAccuracy: 81.4 }

export const accuracyTrend = [
  { d: 'Mon', acc: 72 }, { d: 'Tue', acc: 75 }, { d: 'Wed', acc: 71 }, { d: 'Thu', acc: 79 },
  { d: 'Fri', acc: 77 }, { d: 'Sat', acc: 84 }, { d: 'Sun', acc: 86 },
]

export const recentGames = [
  { id: 'g1', opp: 'Stockfish · Level 5', color: 'w', result: 'Win', how: 'Checkmate', acc: 88.2, opening: 'Italian Game', when: 'Today' },
  { id: 'g2', opp: 'Stockfish · Level 6', color: 'b', result: 'Loss', how: 'Resigned', acc: 71.5, opening: 'Sicilian Defense', when: 'Yesterday' },
  { id: 'g3', opp: 'Stockfish · Level 4', color: 'w', result: 'Draw', how: 'Repetition', acc: 83.0, opening: "Queen's Gambit", when: '2 days ago' },
  { id: 'g4', opp: 'Local game', color: 'w', result: 'Win', how: 'Checkmate', acc: 90.1, opening: 'London System', when: '4 days ago' },
]

export const lessons = [
  { title: 'Rooks belong on open files', tag: 'Positional', mins: 8 },
  { title: 'Spotting back-rank weaknesses', tag: 'Tactics', mins: 6 },
  { title: 'The opposition in king endings', tag: 'Endgames', mins: 11 },
]

export const goals = [
  { label: 'Solve 10 puzzles', done: 7, total: 10 },
  { label: 'Review 1 game', done: 1, total: 1 },
  { label: 'Practise the Caro-Kann', done: 2, total: 5 },
]

export const weaknesses = [
  { label: 'Missed forks', value: 62 },
  { label: 'Back-rank awareness', value: 44 },
  { label: 'Opening preparation', value: 71 },
  { label: 'Endgame technique', value: 38 },
]

export interface Puzzle {
  id: string; fen: string; solution: string[]; theme: string; difficulty: 'Beginner' | 'Easy' | 'Intermediate' | 'Advanced' | 'Expert'
  rating: number; hint: string; explanation: string
}
export const puzzles: Puzzle[] = [
  { id: 'P-1042', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['d1d8'], theme: 'Back-rank tactics', difficulty: 'Beginner', rating: 640,
    hint: "Black's king has no squares to breathe — look at the back rank.", explanation: "Rd8 is checkmate: the pawns on f7, g7 and h7 block the king's own escape squares." },
  { id: 'P-2217', fen: 'r3k3/8/4N3/4B3/8/8/8/4K3 w - - 0 1', solution: ['e6c7', 'e8d7', 'c7a8'], theme: 'Forks', difficulty: 'Easy', rating: 910,
    hint: 'One knight move can attack the king and the rook at once.', explanation: 'Nc7+ forks king and rook. The bishop on e5 guards c7, so the king cannot capture, and the rook on a8 falls.' },
  { id: 'P-3380', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'], theme: 'Checkmate patterns', difficulty: 'Beginner', rating: 700,
    hint: 'f7 is guarded only by the king — and your bishop eyes it too.', explanation: 'Qxf7# is the classic Scholar’s Mate. The queen is protected by the bishop on c4 and the king has no flight squares.' },
  { id: 'P-4471', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', solution: ['g5f7'], theme: 'Checkmate patterns', difficulty: 'Intermediate', rating: 1380,
    hint: "The king is smothered by its own pieces. Which square does a knight check from?", explanation: 'Nf7# is a smothered mate: the king on h8 is boxed in by its own rook and pawns, and only a knight can deliver check.' },
]

export interface Opening { id: string; name: string; eco: string; side: 'White' | 'Black'; blurb: string; idea: string; main: string[]; variations: { name: string; moves: string[] }[]; winRate: number; popularity: number }
export const openings: Opening[] = [
  { id: 'italian', name: 'Italian Game', eco: 'C50', side: 'White', blurb: 'Fast development and pressure on f7.', idea: 'Place the bishop on c4 aimed at f7, castle early and build a centre with c3 and d4.',
    main: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+'.split(' '), winRate: 52, popularity: 88,
    variations: [{ name: 'Giuoco Pianissimo', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6 c3'.split(' ') }, { name: 'Evans Gambit', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O'.split(' ') }] },
  { id: 'ruy', name: 'Ruy Lopez', eco: 'C60', side: 'White', blurb: 'The classical battle for the e5 pawn.', idea: 'Pin the knight that defends e5 and keep long-term pressure on the centre.',
    main: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O'.split(' '), winRate: 54, popularity: 84,
    variations: [{ name: 'Berlin Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5'.split(' ') }] },
  { id: 'sicilian', name: 'Sicilian Defense', eco: 'B90', side: 'Black', blurb: 'Unbalance the position from move one.', idea: 'Trade a wing pawn for a central pawn and play for counter-attack on the queenside.',
    main: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6'.split(' '), winRate: 48, popularity: 95,
    variations: [{ name: 'Dragon Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6'.split(' ') }] },
  { id: 'french', name: 'French Defense', eco: 'C00', side: 'Black', blurb: 'Solid structure, sharp pawn breaks.', idea: 'Challenge the centre with ...d5 and attack the pawn chain at its base with ...c5.',
    main: 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7'.split(' '), winRate: 47, popularity: 62,
    variations: [{ name: 'Advance Variation', moves: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6'.split(' ') }] },
  { id: 'caro', name: 'Caro-Kann Defense', eco: 'B12', side: 'Black', blurb: 'Rock-solid and endgame friendly.', idea: 'Support ...d5 with a pawn and develop the light-squared bishop before closing the chain.',
    main: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7'.split(' '), winRate: 49, popularity: 70,
    variations: [{ name: 'Advance Variation', moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5'.split(' ') }] },
  { id: 'qg', name: "Queen's Gambit", eco: 'D06', side: 'White', blurb: 'Offer a wing pawn, take the centre.', idea: 'The c-pawn is not really a sacrifice — White regains it while keeping more space.',
    main: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6'.split(' '), winRate: 55, popularity: 80,
    variations: [{ name: 'Queen’s Gambit Accepted', moves: 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5'.split(' ') }] },
  { id: 'kid', name: "King's Indian Defense", eco: 'E60', side: 'Black', blurb: 'Let White build, then strike.', idea: 'Fianchetto the bishop, allow a big centre, then attack it with ...e5 or ...c5.',
    main: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6'.split(' '), winRate: 46, popularity: 58,
    variations: [{ name: 'Sämisch Variation', moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5'.split(' ') }] },
  { id: 'london', name: 'London System', eco: 'D02', side: 'White', blurb: 'One setup, almost every time.', idea: 'Develop the bishop outside the pawn chain, then build a compact pyramid with e3, c3 and Nbd2.',
    main: 'd4 d5 Nf3 Nf6 Bf4 c5 e3 Nc6 c3 Qb6 Qb3 c4 Qc2 Bf5'.split(' '), winRate: 51, popularity: 66,
    variations: [{ name: 'Classical setup', moves: 'd4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Nbd2'.split(' ') }] },
  { id: 'english', name: 'English Opening', eco: 'A20', side: 'White', blurb: 'A flexible flank start.', idea: 'Control d5 from the side and keep the option of transposing into many structures.',
    main: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6'.split(' '), winRate: 53, popularity: 64,
    variations: [{ name: 'Symmetrical', moves: 'c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7'.split(' ') }] },
  { id: 'scandi', name: 'Scandinavian Defense', eco: 'B01', side: 'Black', blurb: 'Hit the centre immediately.', idea: 'Trade off White’s e-pawn at once and accept a lead in development for a clear structure.',
    main: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5'.split(' '), winRate: 46, popularity: 48,
    variations: [{ name: 'Modern Scandinavian', moves: 'e4 d5 exd5 Nf6 d4 Nxd5 Nf3 g6 Be2 Bg7'.split(' ') }] },
]

/** Morphy vs Duke of Brunswick & Count Isouard, Paris 1858. Evals are hand-set mock values (pawns, white perspective). */
export const OPERA_SAN = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ')
export const OPERA_EVAL = [0.3, 0.2, 0.3, 0.3, 0.4, 0.4, 0.5, 0.5, 0.4, 0.5, 0.6, 1.3, 1.4, 1.4, 1.6, 1.7, 1.9, 4.2, 4.4, 4.3, 4.5, 4.6, 5.2, 5.3, 6.0, 6.0, 6.5, 7.5, 8.0, 8.0, 9.5, 9.5, 12]
export const OPERA_BEST: Record<number, string> = { 12: 'Qe7', 18: 'Nbd7' }
export const OPERA_SPECIAL: Record<number, 'brilliant' | 'great'> = { 31: 'brilliant', 25: 'great', 19: 'great' }
export const OPERA_NOTES: Record<number, string> = {
  12: 'Nf6 develops, but allows Qb3 with a double attack on f7 and b7. Qe7 would have defended both flank pawns at once.',
  18: 'This pawn push loses a piece to a tactical sequence: after Nxb5 the b5 pawn cannot be recaptured safely and the king in the centre is under fire.',
  19: 'A powerful sacrifice. Taking on b5 opens lines against the black king before Black can finish developing.',
  25: 'Rxd7 removes a key defender and keeps every piece of White’s army active.',
  31: 'The famous queen sacrifice. Qb8+ forces Nxb8 and Rd8# follows, because the black king has no flight squares.',
  33: 'Checkmate. The rook on d8 is protected by the bishop on g5 and the king is boxed in by its own pieces.',
}
