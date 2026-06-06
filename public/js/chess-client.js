// Lightweight client-side chess utility for checking turn color from FEN
class ChessClient {
  static getTurn(fen) {
    return fen.split(' ')[1];
  }

  static isWhitePiece(piece) {
    return piece && piece === piece.toUpperCase();
  }
}
