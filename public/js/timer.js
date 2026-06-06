class ChessTimer {
  constructor(whiteEl, blackEl) {
    this.whiteEl = whiteEl;
    this.blackEl = blackEl;
    this.whiteTime = 600000;
    this.blackTime = 600000;
    this.activeSide = null;
    this.lastSync = Date.now();
    this.interval = null;
  }

  start(whiteTime, blackTime, activeSide) {
    this.whiteTime = whiteTime;
    this.blackTime = blackTime;
    this.activeSide = activeSide;
    this.lastSync = Date.now();
    this.updateDisplay();
    this.startTick();
  }

  sync(whiteTime, blackTime, activeSide) {
    this.whiteTime = whiteTime;
    this.blackTime = blackTime;
    this.activeSide = activeSide;
    this.lastSync = Date.now();
    this.updateDisplay();
  }

  switchSide(side) {
    this.activeSide = side;
    this.lastSync = Date.now();
  }

  stop() {
    this.activeSide = null;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  startTick() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), 100);
  }

  tick() {
    if (!this.activeSide) return;

    const now = Date.now();
    const elapsed = now - this.lastSync;
    this.lastSync = now;

    if (this.activeSide === 'w') {
      this.whiteTime = Math.max(0, this.whiteTime - elapsed);
    } else {
      this.blackTime = Math.max(0, this.blackTime - elapsed);
    }

    this.updateDisplay();
  }

  updateDisplay() {
    this.renderTime(this.whiteEl, this.whiteTime, this.activeSide === 'w');
    this.renderTime(this.blackEl, this.blackTime, this.activeSide === 'b');
  }

  renderTime(el, timeMs, isActive) {
    const totalSec = Math.ceil(timeMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;

    let display;
    if (timeMs < 10000) {
      const tenths = Math.floor((timeMs % 1000) / 100);
      display = `${min}:${sec.toString().padStart(2, '0')}.${tenths}`;
    } else {
      display = `${min}:${sec.toString().padStart(2, '0')}`;
    }

    el.textContent = display;
    el.classList.toggle('timer-active', isActive);
    el.classList.toggle('timer-warning', timeMs < 30000 && timeMs > 10000);
    el.classList.toggle('timer-critical', timeMs <= 10000);
  }

  destroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
