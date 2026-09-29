export function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
}

export function chips(value) {
  const bb = value / 100;
  return `${bb.toFixed(1)} bb`;
}

export function cards(cardCodes, faceDown = false) {
  const group = element('span', 'cards');
  for (const code of cardCodes) {
    const card = element('span', faceDown ? 'card card-back' : `card ${/[dh]$/.test(code) ? 'card-red' : ''}`);
    if (faceDown) {
      card.setAttribute('aria-label', 'Face-down card');
      card.textContent = '✦';
    } else {
      const suit = { c: '♣', d: '♦', h: '♥', s: '♠' }[code[1]] ?? '?';
      card.textContent = `${code[0]}${suit}`;
      card.setAttribute('aria-label', `${code[0]} of ${{ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[code[1]]}`);
    }
    group.append(card);
  }
  return group;
}
