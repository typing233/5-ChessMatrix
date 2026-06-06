const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

class ChessBoard3D {
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

    this.pieces3D = new Map();
    this.squareMeshes = new Map();
    this.legalMoveMarkers = [];
    this.animating = false;

    this.init();
  }

  init() {
    const w = this.container.clientWidth || 560;
    const h = this.container.clientHeight || 560;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 10, 8);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = Math.PI * 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 12, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -8;
    dirLight.shadow.camera.right = 8;
    dirLight.shadow.camera.top = 8;
    dirLight.shadow.camera.bottom = -8;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.2);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);

    this.buildBoard();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));

    this.animate();
    this.render();

    window.addEventListener('resize', () => this.onResize());
  }

  buildBoard() {
    const boardGroup = new THREE.Group();

    const baseGeo = new THREE.BoxGeometry(8.4, 0.3, 8.4);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2c2c3e, roughness: 0.8 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.2;
    base.receiveShadow = true;
    boardGroup.add(base);

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xf0d9b5, roughness: 0.6, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0xb58863, roughness: 0.6, metalness: 0.05 });
    const squareGeo = new THREE.BoxGeometry(1, 0.1, 1);

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const isLight = (r + f) % 2 === 0;
        const mesh = new THREE.Mesh(squareGeo, (isLight ? lightMat : darkMat).clone());
        const pos = this.boardToWorld(f, r);
        mesh.position.set(pos.x, 0, pos.z);
        mesh.receiveShadow = true;
        mesh.userData = { file: f, rank: r, square: FILES[f] + RANKS[r] };
        boardGroup.add(mesh);
        this.squareMeshes.set(FILES[f] + RANKS[r], mesh);
      }
    }

    this.scene.add(boardGroup);
    this.boardGroup = boardGroup;
  }

  boardToWorld(file, rank) {
    return { x: file - 3.5, z: rank - 3.5 };
  }

  worldToBoard(x, z) {
    const file = Math.round(x + 3.5);
    const rank = Math.round(z + 3.5);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return { file, rank };
  }

  createPieceMesh(pieceChar) {
    const isWhite = pieceChar === pieceChar.toUpperCase();
    const color = isWhite ? 0xfaf0e6 : 0x2d2d2d;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: isWhite ? 0.4 : 0.5,
      metalness: isWhite ? 0.2 : 0.3,
    });

    const type = pieceChar.toLowerCase();
    let group = new THREE.Group();

    switch (type) {
      case 'p': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.2, 16), mat);
        base.position.y = 0.1;
        group.add(base);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.3, 16), mat);
        body.position.y = 0.35;
        group.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), mat);
        head.position.y = 0.6;
        group.add(head);
        break;
      }
      case 'r': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.2, 16), mat);
        base.position.y = 0.1;
        group.add(base);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.5, 16), mat);
        body.position.y = 0.45;
        group.add(body);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.15, 16), mat);
        top.position.y = 0.78;
        group.add(top);
        for (let i = 0; i < 4; i++) {
          const cren = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.12), mat);
          const angle = (i / 4) * Math.PI * 2;
          cren.position.set(Math.cos(angle) * 0.2, 0.93, Math.sin(angle) * 0.2);
          group.add(cren);
        }
        break;
      }
      case 'n': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.2, 16), mat);
        base.position.y = 0.1;
        group.add(base);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.4, 16), mat);
        body.position.y = 0.4;
        group.add(body);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.38), mat);
        head.position.set(0, 0.75, 0.05);
        head.rotation.x = -0.3;
        group.add(head);
        const snout = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.25), mat);
        snout.position.set(0, 0.65, 0.25);
        snout.rotation.x = -0.2;
        group.add(snout);
        break;
      }
      case 'b': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.2, 16), mat);
        base.position.y = 0.1;
        group.add(base);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 0.55, 16), mat);
        body.position.y = 0.48;
        group.add(body);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.35, 16), mat);
        tip.position.y = 0.93;
        group.add(tip);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), mat);
        ball.position.y = 1.15;
        group.add(ball);
        break;
      }
      case 'q': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.2, 16), mat);
        base.position.y = 0.1;
        group.add(base);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.28, 0.6, 16), mat);
        body.position.y = 0.5;
        group.add(body);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 16), mat);
        crown.position.y = 0.9;
        group.add(crown);
        for (let i = 0; i < 5; i++) {
          const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 8), mat);
          const angle = (i / 5) * Math.PI * 2;
          point.position.set(Math.cos(angle) * 0.15, 1.08, Math.sin(angle) * 0.15);
          group.add(point);
        }
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), mat);
        ball.position.y = 1.15;
        group.add(ball);
        break;
      }
      case 'k': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.2, 16), mat);
        base.position.y = 0.1;
        group.add(base);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.28, 0.6, 16), mat);
        body.position.y = 0.5;
        group.add(body);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 16), mat);
        crown.position.y = 0.9;
        group.add(crown);
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), mat);
        crossV.position.y = 1.15;
        group.add(crossV);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), mat);
        crossH.position.y = 1.22;
        group.add(crossH);
        break;
      }
    }

    group.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
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
    this.clearPieces();
    this.clearMarkers();
    this.updateSquareHighlights();

    const board = this.parseFen();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (piece) {
          const mesh = this.createPieceMesh(piece);
          const pos = this.boardToWorld(f, r);
          mesh.position.set(pos.x, 0.05, pos.z);
          mesh.userData = { piece, file: f, rank: r, square: FILES[f] + RANKS[r] };
          this.scene.add(mesh);
          this.pieces3D.set(FILES[f] + RANKS[r], mesh);
        }
      }
    }

    if (this.selectedSquare && this.legalMoves[this.selectedSquare]) {
      this.showLegalMoveMarkers(this.legalMoves[this.selectedSquare]);
    }
  }

  clearPieces() {
    for (const [, mesh] of this.pieces3D) {
      this.scene.remove(mesh);
    }
    this.pieces3D.clear();
  }

  clearMarkers() {
    for (const marker of this.legalMoveMarkers) {
      this.scene.remove(marker);
    }
    this.legalMoveMarkers = [];
  }

  updateSquareHighlights() {
    for (const [square, mesh] of this.squareMeshes) {
      const f = FILES.indexOf(square[0]);
      const r = RANKS.indexOf(square[1]);
      const isLight = (r + f) % 2 === 0;
      const baseColor = isLight ? 0xf0d9b5 : 0xb58863;

      if (this.selectedSquare === square) {
        mesh.material.color.setHex(0xffff66);
        mesh.material.emissive.setHex(0x333300);
      } else if (this.lastMove && (this.lastMove.from === square || this.lastMove.to === square)) {
        mesh.material.color.setHex(0x9bc700);
        mesh.material.emissive.setHex(0x1a2200);
      } else if (this.checkSquare === square) {
        mesh.material.color.setHex(0xff4444);
        mesh.material.emissive.setHex(0x440000);
      } else {
        mesh.material.color.setHex(baseColor);
        mesh.material.emissive.setHex(0x000000);
      }
    }
  }

  showLegalMoveMarkers(targets) {
    const board = this.parseFen();
    for (const sq of targets) {
      const f = FILES.indexOf(sq[0]);
      const r = RANKS.indexOf(sq[1]);
      const pos = this.boardToWorld(f, r);
      const hasPiece = board[r][f] !== null;

      let marker;
      if (hasPiece) {
        const geo = new THREE.RingGeometry(0.35, 0.45, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        marker = new THREE.Mesh(geo, mat);
        marker.rotation.x = -Math.PI / 2;
      } else {
        const geo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.5 });
        marker = new THREE.Mesh(geo, mat);
      }
      marker.position.set(pos.x, 0.08, pos.z);
      marker.userData = { isMarker: true, square: sq };
      this.scene.add(marker);
      this.legalMoveMarkers.push(marker);
    }
  }

  onClick(event) {
    if (!this.interactive || this.animating) return;
    if (this.myColor && this.currentTurn !== this.myColor) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const allTargets = [...this.squareMeshes.values(), ...this.legalMoveMarkers];
    const pieceMeshes = [];
    for (const [, p] of this.pieces3D) {
      p.traverse(child => { if (child.isMesh) pieceMeshes.push(child); });
    }

    const intersects = this.raycaster.intersectObjects([...allTargets, ...pieceMeshes]);
    if (intersects.length === 0) return;

    let clickedSquare = null;
    for (const hit of intersects) {
      if (hit.object.userData.square) {
        clickedSquare = hit.object.userData.square;
        break;
      }
      if (hit.object.userData.isMarker) {
        clickedSquare = hit.object.userData.square;
        break;
      }
      let parent = hit.object.parent;
      while (parent) {
        if (parent.userData && parent.userData.square) {
          clickedSquare = parent.userData.square;
          break;
        }
        parent = parent.parent;
      }
      if (clickedSquare) break;
    }

    if (!clickedSquare) return;
    this.handleClick(clickedSquare);
  }

  handleClick(square) {
    const board = this.parseFen();
    const f = FILES.indexOf(square[0]);
    const r = RANKS.indexOf(square[1]);
    const piece = board[r][f];

    if (this.selectedSquare) {
      if (this.selectedSquare === square) {
        this.selectedSquare = null;
        this.render();
        return;
      }

      if (this.legalMoves[this.selectedSquare] && this.legalMoves[this.selectedSquare].includes(square)) {
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
    const labels = ['Queen', 'Rook', 'Bishop', 'Knight'];
    const promoValues = ['q', 'r', 'b', 'n'];

    pieces.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      btn.textContent = labels[i];
      btn.addEventListener('click', () => {
        modal.classList.add('hidden');
        this.emitMove(from, to, promoValues[i]);
      });
      choices.appendChild(btn);
    });

    modal.classList.remove('hidden');
  }

  emitMove(from, to, promotion) {
    if (this.onMove) this.onMove(from, to, promotion);
  }

  setPosition(fen) {
    this.fen = fen;
    this.render();
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    if (flipped) {
      this.camera.position.set(0, 10, -8);
    } else {
      this.camera.position.set(0, 10, 8);
    }
    this.controls.update();
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

  disable() { this.interactive = false; }
  enable() { this.interactive = true; }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
