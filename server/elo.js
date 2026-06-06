const K_FACTOR = 32;

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateNewRatings(whiteElo, blackElo, result) {
  const whiteExpected = expectedScore(whiteElo, blackElo);
  const blackExpected = expectedScore(blackElo, whiteElo);

  let whiteScore, blackScore;
  if (result === 'white') {
    whiteScore = 1;
    blackScore = 0;
  } else if (result === 'black') {
    whiteScore = 0;
    blackScore = 1;
  } else {
    whiteScore = 0.5;
    blackScore = 0.5;
  }

  const newWhiteElo = Math.round(whiteElo + K_FACTOR * (whiteScore - whiteExpected));
  const newBlackElo = Math.round(blackElo + K_FACTOR * (blackScore - blackExpected));

  return { newWhiteElo, newBlackElo };
}

module.exports = { calculateNewRatings };
