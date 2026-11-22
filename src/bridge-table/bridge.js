(function () {
  const seats = ['N', 'E', 'S', 'W'];
  const boardNumbers = Array.from({ length: 16 }, (_, index) => index + 1);
  const vulnerabilityByBoard = [
    'None', 'NS', 'EW', 'All', 'NS', 'EW', 'All', 'None',
    'EW', 'All', 'None', 'NS', 'All', 'None', 'NS', 'EW',
  ];
  const denominations = ['C', 'D', 'H', 'S', 'NT'];
  const suits = ['S', 'H', 'D', 'C'];
  const ranks = 'AKQJT98765432';
  const fullDeck = suits.flatMap(suit => [...ranks].map(rank => rank + suit));
  const boardDefaults = number => ({
    dealer: seats[(number - 1) % seats.length], vul: vulnerabilityByBoard[number - 1],
  });
  const localDate = () => {
    const time = new Date();
    return [time.getFullYear(), time.getMonth() + 1, time.getDate()]
      .map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('.');
  };

  function auction(dealer, calls) {
    const start = seats.indexOf(dealer);
    let bid = null;
    let risk = '';
    let passes = 0;
    let highest = -1;
    let lastBidder = null;
    const first = {};
    calls.forEach((call, i) => {
      const seat = (start + i) % 4;
      if (call === 'Pass') { passes++; return; }
      passes = 0;
      if (call === 'X' || call === 'XX') { risk = call; return; }
      risk = '';
      bid = call;
      const denomination = call.slice(1);
      highest = (Number(call[0]) - 1) * 5 + denominations.indexOf(denomination);
      lastBidder = seat;
      first[seat % 2 + denomination] ??= seats[seat];
    });
    const index = (start + calls.length) % 4;
    const done = passes >= (bid ? 3 : 4);
    return {
      done, next: seats[index], bid, highest,
      contract: bid ? bid + risk : 'Pass',
      declarer: bid ? first[lastBidder % 2 + bid.slice(1)] : '',
      double: !done && bid && !risk && index % 2 !== lastBidder % 2,
      redouble: !done && risk === 'X' && index % 2 === lastBidder % 2,
    };
  }

  function duplicateScore(board, state = auction(board.dealer, board.calls)) {
    if (!state.done) return null;
    if (!state.bid) return 0;
    if (!Number.isInteger(board.tricks) || board.tricks < 0 || board.tricks > 13) return null;

    const isNorthSouth = state.declarer === 'N' || state.declarer === 'S';
    const vulnerable = board.vul === 'All' || board.vul === (isNorthSouth ? 'NS' : 'EW');
    const level = Number(state.bid[0]);
    const strain = state.bid.slice(1);
    const unit = strain === 'C' || strain === 'D' ? 20 : 30;
    const doubles = state.contract.length - state.bid.length;
    const multiplier = 2 ** doubles;
    const over = board.tricks - (level + 6);
    let declarerScore;

    if (over >= 0) {
      const trickPoints = (level * unit + (strain === 'NT' ? 10 : 0)) * multiplier;
      const gameBonus = trickPoints < 100 ? 50 : vulnerable ? 500 : 300;
      const slamBonus = level === 7 ? (vulnerable ? 1500 : 1000)
        : level === 6 ? (vulnerable ? 750 : 500) : 0;
      const doubledBonus = doubles * 50;
      const extra = multiplier === 1 ? over * unit : over * (vulnerable ? 200 : 100) * (multiplier / 2);
      declarerScore = trickPoints + gameBonus + slamBonus + doubledBonus + extra;
    } else {
      const down = -over;
      const doubledPenalty = vulnerable ? 200 + (down - 1) * 300
        : 100 + Math.min(down - 1, 2) * 200 + Math.max(down - 3, 0) * 300;
      declarerScore = -(multiplier === 1 ? down * (vulnerable ? 100 : 50) : doubledPenalty * (multiplier / 2));
    }
    return isNorthSouth ? declarerScore : -declarerScore;
  }

  function emptyDeal() {
    return Object.fromEntries(seats.map(seat => [seat, []]));
  }

  function validateDeal(deal) {
    const cards = seats.flatMap(seat => deal[seat] ?? []);
    return seats.every(seat => deal[seat]?.length === 13)
      && new Set(cards).size === 52 && cards.every(card => fullDeck.includes(card));
  }

  function dealTag(deal) {
    return 'N:' + seats.map(seat => suits.map(suit =>
      [...ranks].filter(rank => deal[seat].includes(rank + suit)).join('')
    ).join('.')).join(' ');
  }

  function parseObservedDeal(input) {
    const value = input.match(/\[Deal\s+"([^"]+)"\]/i)?.[1] ?? input.trim();
    const match = value.toUpperCase().match(/^([NESW]):\s*([AKQJT2-9.]+)\s+([AKQJT2-9.]+)\s+([AKQJT2-9.]+)\s+([AKQJT2-9.]+)$/);
    if (!match) return null;
    const deal = emptyDeal();
    for (const [i, hand] of match.slice(2).entries()) {
      const groups = hand.split('.');
      if (groups.length !== 4) return null;
      const seat = seats[(seats.indexOf(match[1]) + i) % 4];
      deal[seat] = groups.flatMap((group, s) => [...group].map(rank => rank + suits[s]));
      if (deal[seat].length > 13) return null;
    }
    const cards = Object.values(deal).flat();
    return cards.length && new Set(cards).size === cards.length ? deal : null;
  }

  function parseDeal(input) {
    const deal = parseObservedDeal(input);
    return deal && validateDeal(deal) ? deal : null;
  }

  function canExport(board) {
    const state = auction(board.dealer, board.calls);
    return state.done && (state.contract === 'Pass'
      || (Number.isInteger(board.tricks) && board.tricks >= 0 && board.tricks <= 13))
      && board.confirmed && validateDeal(board.deal);
  }

  function exportPbn(boards) {
    const games = boards.map(board => {
      if (!canExport(board)) throw new Error('叫牌、赛果或牌面未完成');
      const state = auction(board.dealer, board.calls);
      const tags = {
        Event: 'Bridge Practice', Site: '?', Date: board.date, Board: board.number,
        West: '?', North: '?', East: '?', South: '?', Dealer: board.dealer,
        Vulnerable: board.vul, Deal: dealTag(board.deal), Scoring: '?',
        Declarer: state.declarer, Contract: state.contract,
        Result: state.contract === 'Pass' ? '' : board.tricks,
        Score: 'NS ' + duplicateScore(board, state), Auction: board.dealer,
      };
      const lines = Object.entries(tags).map(([key, value]) => '[' + key + ' "' + value + '"]');
      for (let i = 0; i < board.calls.length; i += 4) lines.push(board.calls.slice(i, i + 4).join(' '));
      return lines.join('\r\n');
    });
    return '% PBN 2.1\r\n% EXPORT\r\n\r\n' + games.join('\r\n\r\n') + '\r\n\r\n';
  }

  globalThis.Bridge = { seats, boardNumbers, boardDefaults, denominations, suits, ranks, fullDeck, localDate, auction,
    duplicateScore, emptyDeal, validateDeal, dealTag, parseDeal, parseObservedDeal, canExport, exportPbn };
})();
