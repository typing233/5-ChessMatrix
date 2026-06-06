const PIECES = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

class ChessBoard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.flipped = false;
    this.selectedSquare = null;
    this.legalMoves = {};
    this.lastMove = null;
    this.checkSquare = null;
    this.onMove = null;
    this.interactive = true;
    this.myColor = null;
    this.currentTurn = 'w';
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.pendingPromotion = null;

    this.render();
  }

  setPosition(fen) {
    this.fen = fen;
    this.render();
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    this.render();
  }

  setLegalMoves(moves) {
    this.legalMoves = moves || {};
  }

  setLastMove(from, to) {
    this.lastMove = { from, to };
    this.render();
  }

  setCheck(square) {
    this.checkSquare = square;
    this.render();
  }

  parseFen() {
    const board = [];
    const rows = this.fen.split(' ')[0].split('/');
    for (const row of rows) {
      const boardRow = [];
      for (const ch of row) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < parseInt(ch); i++) boardRow.push(null);
        } else {
          boardRow.push(ch);
        }
      }
      board.push(boardRow);
    }
    return board;
  }

  render() {
    this.container.innerHTML = '';
    const board = this.parseFen();

    const ranks = this.flipped ? [...RANKS].reverse() : RANKS;
    const files = this.flipped ? [...FILES].reverse() : FILES;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rank = ranks[r];
        const file = files[f];
        const square = file + rank;
        const boardR = RANKS.indexOf(rank);
        const boardF = FILES.indexOf(file);
        const piece = board[boardR][boardF];

        const isLight = (boardR + boardF) % 2 === 0;
        const el = document.createElement('div');
        el.className = `square ${isLight ? 'light' : 'dark'}`;
        el.dataset.square = square;

        if (this.selectedSquare === square) el.classList.add('selected');
        if (this.lastMove && (this.lastMove.from === square || this.lastMove.to === square)) {
          el.classList.add('last-move');
        }
        if (this.checkSquare === square) el.classList.add('check');

        if (this.selectedSquare && this.legalMoves[this.selectedSquare]) {
          if (this.legalMoves[this.selectedSquare].includes(square)) {
            el.classList.add(piece ? 'legal-capture' : 'legal-move');
          }
        }

        if (piece) {
          const pieceEl = document.createElement('span');
          pieceEl.className = 'piece';
          pieceEl.textContent = PIECES[piece];
          el.appendChild(pieceEl);
        }

        // Coordinates
        if (f === 0) {
          const coord = document.createElement('span');
          coord.className = 'coord coord-rank';
          coord.textContent = rank;
          el.appendChild(coord);
        }
        if (r === 7) {
          const coord = document.createElement('span');
          coord.className = 'coord coord-file';
          coord.textContent = file;
          el.appendChild(coord);
        }

        el.addEventListener('click', () => this.handleClick(square, piece));
        this.container.appendChild(el);
      }
    }
  }

  handleClick(square, piece) {
    if (!this.interactive) return;
    if (this.myColor && this.currentTurn !== this.myColor) return;

    if (this.selectedSquare) {
      if (this.selectedSquare === square) {
        this.selectedSquare = null;
        this.render();
        return;
      }

      if (this.legalMoves[this.selectedSquare] && this.legalMoves[this.selectedSquare].includes(square)) {
        // Check for promotion
        const fromPiece = this.getPieceAt(this.selectedSquare);
        const isPromotion = (fromPiece === 'P' && square[1] === '8') || (fromPiece === 'p' && square[1] === '1');

        if (isPromotion) {
          this.showPromotionModal(this.selectedSquare, square);
        } else {
          this.emitMove(this.selectedSquare, square);
        }
        this.selectedSquare = null;
        this.render();
        return;
      }

      // Select new piece if it's own piece
      if (piece && this.isOwnPiece(piece)) {
        this.selectedSquare = square;
        this.render();
        return;
      }

      this.selectedSquare = null;
      this.render();
      return;
    }

    if (piece && this.isOwnPiece(piece)) {
      this.selectedSquare = square;
      this.render();
    }
  }

  isOwnPiece(piece) {
    if (!this.myColor) return true;
    if (this.myColor === 'w') return piece === piece.toUpperCase();
    return piece === piece.toLowerCase();
  }

  getPieceAt(square) {
    const board = this.parseFen();
    const r = RANKS.indexOf(square[1]);
    const f = FILES.indexOf(square[0]);
    return board[r][f];
  }

  showPromotionModal(from, to) {
    const modal = document.getElementById('promotion-modal');
    const choices = modal.querySelector('.promotion-choices');
    choices.innerHTML = '';

    const pieces = this.myColor === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
    const promoValues = ['q', 'r', 'b', 'n'];

    pieces.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'piece-btn';
      btn.textContent = PIECES[p];
      btn.addEventListener('click', () => {
        modal.classList.add('hidden');
        this.emitMove(from, to, promoValues[i]);
      });
      choices.appendChild(btn);
    });

    modal.classList.remove('hidden');
  }

  emitMove(from, to, promotion) {
    if (this.onMove) {
      this.onMove(from, to, promotion);
    }
  }

  disable() {
    this.interactive = false;
  }

  enable() {
    this.interactive = true;
  }
}
