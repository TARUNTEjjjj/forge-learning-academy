// A small synchronous stand-in for React, so the Node suite can render the real Practice and Projects components:
// Node has no DOM, and this repository installs no DOM library. It covers only what those components use: the JSX
// runtime, useState, useRef, useEffect, useCallback, useMemo and useSyncExternalStore. Component code runs unchanged,
// so each render's handlers close over that render's values, as in React. State updates re-render when flush() runs,
// which tests call after each event, and effects run after a render whose dependencies changed. Keys are ignored and
// each component function has one instance, so render one tree at a time.
const ELEMENT = Symbol.for("react-stand-in.element");
export const Fragment = Symbol.for("react-stand-in.fragment");
export function jsx(type, props, key) { return { $$typeof: ELEMENT, type, props: props ?? {}, key }; }
export const jsxs = jsx;

let instances = new Map(), current = null, hookIndex = 0, dirty = false, effects = [], root = null;
/** The rendered host tree: { type, props, children } nodes and strings. */
export let tree = null;

function hook(create) {
  if (!current) throw new Error("A hook was called outside a component render.");
  const index = hookIndex++;
  if (!(index in current)) current[index] = create();
  return current[index];
}
const changed = (previous, next) => !previous || !next || next.length !== previous.length || next.some((value, index) => !Object.is(value, previous[index]));
export function useState(initial) {
  const slot = hook(() => ({ value: typeof initial === "function" ? initial() : initial }));
  slot.set ??= next => {
    const value = typeof next === "function" ? next(slot.value) : next;
    if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
  };
  return [slot.value, slot.set];
}
export function useRef(initial) { return hook(() => ({ current: initial })); }
export function useMemo(create, deps) {
  const slot = hook(() => ({}));
  if (!("value" in slot) || changed(slot.deps, deps)) Object.assign(slot, { value: create(), deps });
  return slot.value;
}
export function useCallback(callback, deps) { return useMemo(() => callback, deps); }
export function useEffect(effect, deps) {
  const slot = hook(() => ({ kind: "effect", ran: false }));
  if (!slot.ran || changed(slot.deps, deps)) effects.push({ slot, effect, deps });
}
/** Subscribes once per hook; a component that changes its subscribe function would need a new render. */
export function useSyncExternalStore(subscribe, getSnapshot) {
  const slot = hook(() => ({ kind: "store" }));
  slot.unsubscribe ??= subscribe(() => { dirty = true; });
  return getSnapshot();
}

function renderNode(node) {
  if (node == null || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderNode);
  if (node.$$typeof !== ELEMENT) throw new Error(`Cannot render ${String(node)}.`);
  if (node.type === Fragment) return renderNode(node.props.children);
  if (typeof node.type === "function") {
    if (!instances.has(node.type)) instances.set(node.type, []);
    const saved = [current, hookIndex];
    [current, hookIndex] = [instances.get(node.type), 0];
    let output;
    try { output = node.type(node.props); } finally { [current, hookIndex] = saved; }
    return renderNode(output);
  }
  const { children, ref, ...props } = node.props;
  if (ref && typeof ref === "object" && !ref.current) ref.current = { focus() {}, scrollTop: 0 };
  return { type: node.type, props, children: renderNode(children) };
}

/** Re-render while state changed, running effects after each render. */
export function flush() {
  for (let renders = 0; dirty; renders++) {
    if (renders > 100) throw new Error("The component keeps re-rendering.");
    dirty = false;
    tree = renderNode(root);
    const pending = effects; effects = [];
    for (const { slot, effect, deps } of pending) {
      slot.cleanup?.();
      Object.assign(slot, { ran: true, deps, cleanup: undefined });
      const cleanup = effect();
      if (typeof cleanup === "function") slot.cleanup = cleanup;
    }
  }
}
export function render(element) { unmount(); root = element; dirty = true; flush(); }
/** Runs effect cleanups and store unsubscriptions, as React does when a tree is removed. */
export function unmount() {
  for (const slots of instances.values()) for (const slot of slots) {
    if (slot?.kind === "effect") slot.cleanup?.();
    if (slot?.kind === "store") slot.unsubscribe?.();
  }
  instances = new Map(); root = null; tree = null; dirty = false; effects = [];
}

/** Every rendered host node that matches, in document order. */
export function findAll(match, node = tree) {
  const found = [];
  const visit = item => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") { if (match(item)) found.push(item); visit(item.children); }
  };
  visit(node);
  return found;
}
export const text = node => node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node.children);
export const hasClass = (node, name) => String(node.props.className ?? "").split(/\s+/).includes(name);
