(() => {
  const B = globalThis.Bridge;
  const rooms = { open: '开室', closed: '闭室' };
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codePattern = /^[A-HJ-NP-Z2-9]{8}$/;
  const thresholds = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600,
    750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000];
  const validRoom = room => Object.hasOwn(rooms, room);
  const validCode = code => typeof code === 'string' && codePattern.test(code);
  const codeFrom = value => value.trim().toUpperCase();
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), value => alphabet[value % 32]).join('');
  const otherRoom = room => room === 'open' ? 'closed' : 'open';

  function imps(difference) {
    let count = 0;
    for (const threshold of thresholds) {
      if (Math.abs(difference) < threshold) break;
      count++;
    }
    return difference < 0 && count ? -count : count;
  }

  // WBF continuous 20-VP scale, fixed at 16 boards for this match format.
  const scale = (() => {
    const tau = (Math.sqrt(5) - 1) / 2;
    const values = Array.from({ length: 61 }, (_, margin) =>
      Math.round(1000 + 1000 * (1 - tau ** (margin / 20)) / (1 - tau ** 3)));
    let changed;
    do {
      changed = false;
      for (let i = 1; i < 60; i++) {
        if (values[i + 1] - values[i] > values[i] - values[i - 1]) {
          values[i]++;
          changed = true;
        }
      }
    } while (changed);
    return values;
  })();

  function victoryPoints(margin) {
    const winner = scale[Math.min(60, Math.abs(margin))];
    const loser = 2000 - winner;
    return (margin < 0 ? [loser, winner] : [winner, loser]).map(value => value / 100);
  }

  function snapshot(board) {
    return { number: board.number, dealer: board.dealer, vul: board.vul, calls: board.calls,
      tricks: board.tricks, dealTag: board.confirmed && B.validateDeal(board.deal) ? B.dealTag(board.deal) : '' };
  }

  function validAuction(dealer, calls) {
    if (!Array.isArray(calls) || calls.length > 320) return false;
    const prior = [];
    for (const call of calls) {
      const state = B.auction(dealer, prior);
      if (state.done || typeof call !== 'string') return false;
      if (call === 'X' && !state.double || call === 'XX' && !state.redouble) return false;
      if (!['Pass', 'X', 'XX'].includes(call)) {
        if (!/^[1-7](?:[CDHS]|NT)$/.test(call)) return false;
        if ((Number(call[0]) - 1) * 5 + B.denominations.indexOf(call.slice(1)) <= state.highest) return false;
      }
      prior.push(call);
    }
    return true;
  }

  function encode(code, room, boards) {
    return JSON.stringify({ bridgeMatch: 1, code, room, boards: boards.map(snapshot) });
  }

  function decode(text) {
    if (text.length > 100000) throw new Error('成绩文本过长');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('无法读取成绩，请粘贴完整文本'); }
    if (data?.bridgeMatch !== 1 || !validCode(data.code) || !validRoom(data.room)
        || !Array.isArray(data.boards) || !data.boards.length || data.boards.length > 16) {
      throw new Error('成绩格式不对，请重新复制');
    }
    const seen = new Set();
    const boards = data.boards.map(item => {
      if (!item || !B.boardNumbers.includes(item.number) || seen.has(item.number) || !B.seats.includes(item.dealer)
          || !['None', 'NS', 'EW', 'All'].includes(item.vul) || !validAuction(item.dealer, item.calls)
          || (item.tricks !== null && (!Number.isInteger(item.tricks) || item.tricks < 0 || item.tricks > 13))
          || typeof item.dealTag !== 'string' || (item.dealTag && !B.parseDeal(item.dealTag))) {
        throw new Error('成绩里有无效牌例');
      }
      seen.add(item.number);
      return { number: item.number, dealer: item.dealer, vul: item.vul, calls: item.calls,
        tricks: item.tricks, dealTag: item.dealTag ? B.dealTag(B.parseDeal(item.dealTag)) : '' };
    });
    return { code: data.code, room: data.room, boards };
  }

  function compare(match) {
    const table = room => {
      const books = new Map((match.received[room] ?? []).map(board => [board.number, board]));
      for (const board of match.tables[room]?.boards ?? []) books.set(board.number, snapshot(board));
      return books;
    };
    const open = table('open');
    const closed = table('closed');
    let a = 0;
    let b = 0;
    let played = 0;
    let conflicts = 0;
    const rows = B.boardNumbers.map(number => {
      const left = open.get(number) ?? null;
      const right = closed.get(number) ?? null;
      const leftScore = left && B.duplicateScore(left);
      const rightScore = right && B.duplicateScore(right);
      const issue = left && right && (left.dealer !== right.dealer || left.vul !== right.vul)
        ? '发牌人或局况不同' : left?.dealTag && right?.dealTag && left.dealTag !== right.dealTag ? '牌面不同' : '';
      const imp = !issue && leftScore !== null && rightScore !== null ? imps(leftScore - rightScore) : null;
      if (issue) conflicts++;
      if (imp !== null) {
        played++;
        a += Math.max(0, imp);
        b += Math.max(0, -imp);
      }
      return { number, left, right, leftScore, rightScore, imp, issue };
    });
    return { rows, a, b, played, conflicts, vp: played === 16 ? victoryPoints(a - b) : null };
  }

  globalThis.BridgeMatch = { rooms, validRoom, validCode, codeFrom, newCode, otherRoom, encode, decode, compare, imps, victoryPoints };
})();
