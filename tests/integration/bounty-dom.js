export class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
    this.className = ''; this.events = {}; this.attributes = {};
    this.classList = {
      add: name => { this.className += ` ${name}`; },
      toggle: (name, on) => {
        this.className = this.className.split(' ').filter(value => value !== name).join(' ');
        if (on) this.classList.add(name);
      },
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { this.events[event] = callback; }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    const matches = node => selector.split(',').some(part => {
      const value = part.trim();
      return value.startsWith('.') ? node.className.split(' ').includes(value.slice(1))
        : value.startsWith('#') ? node.id === value.slice(1) : node.tag === value;
    });
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

export function setup(t) {
  const previous = ['document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => new Node(tag), documentElement: new Node('html'),
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => previous.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }));
  return storage;
}
export const text = node => [node.textContent ?? '', ...node.children.map(text)].join(' ');
