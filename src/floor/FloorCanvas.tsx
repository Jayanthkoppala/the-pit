import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { fleetSnapshot, useFleet } from '../fleet/store';
import type { Agent, AgentState } from '../fleet/types';

const STATE_COLOR: Record<AgentState, number> = {
  spawning: 0x6b7280,
  thinking: 0x3b82f6,
  tool: 0xf59e0b,
  blocked: 0xef4444,
  done: 0x22c55e,
  failed: 0x7f1d1d,
};

const nameStyle: TextStyleOptions = { fill: 0xe5e7eb, fontSize: 13, fontFamily: 'ui-monospace, monospace', fontWeight: '600' };
const roleStyle: TextStyleOptions = { fill: 0x94a3b8, fontSize: 10, fontFamily: 'ui-monospace, monospace' };
const taskStyle: TextStyleOptions = { fill: 0x64748b, fontSize: 10, fontFamily: 'ui-monospace, monospace' };

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Deterministic layout: roots along a lane, their sub-agents clustered below.
function layout(agents: Record<string, Agent>, order: string[]) {
  const pos: Record<string, { x: number; y: number }> = {};
  const roots = order.filter((id) => agents[id] && agents[id].parentId == null);
  roots.forEach((rid, i) => {
    const rx = 340 + i * 460;
    const ry = 190;
    pos[rid] = { x: rx, y: ry };
    const subs = order.filter((id) => agents[id]?.parentId === rid);
    const span = 230;
    subs.forEach((sid, j) => {
      const t = subs.length === 1 ? 0.5 : j / (subs.length - 1);
      pos[sid] = { x: rx - span + t * span * 2, y: ry + 210 };
    });
  });
  return pos;
}

interface SpriteRefs {
  root: Container;
  body: Graphics;
  head: Graphics;
  pip: Graphics;
  ring: Graphics;
  orbit: Container;
  name: Text;
  role: Text;
  task: Text;
}

export function FloorCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const app = new Application();
    const sprites = new Map<string, SpriteRefs>();
    let cleanupTicker: (() => void) | null = null;

    (async () => {
      await app.init({ background: 0x0e1116, antialias: false, resizeTo: hostRef.current!, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
      if (disposed) {
        app.destroy(true);
        return;
      }
      hostRef.current!.appendChild(app.canvas);

      // ----- floor grid (drawn once, resized on the fly) -----
      const grid = new Graphics();
      app.stage.addChild(grid);
      const drawGrid = () => {
        grid.clear();
        const { width, height } = app.renderer;
        grid.rect(0, 0, width, height).fill(0x0e1116);
        const step = 40;
        for (let x = 0; x <= width; x += step) grid.moveTo(x, 0).lineTo(x, height);
        for (let y = 0; y <= height; y += step) grid.moveTo(0, y).lineTo(width, y);
        grid.stroke({ width: 1, color: 0x161d26, alpha: 1 });
      };
      drawGrid();
      app.renderer.on('resize', drawGrid);

      const world = new Container();
      app.stage.addChild(world);

      function makeSprite(a: Agent): SpriteRefs {
        const root = new Container();
        root.eventMode = 'static';
        root.cursor = 'pointer';
        const shadow = new Graphics().ellipse(0, 30, 26, 8).fill({ color: 0x000000, alpha: 0.35 });
        const ring = new Graphics();
        const body = new Graphics();
        const head = new Graphics();
        const pip = new Graphics();
        const orbit = new Container();
        const name = new Text({ text: a.name, style: nameStyle });
        const role = new Text({ text: a.role.toUpperCase(), style: roleStyle });
        const task = new Text({ text: '', style: taskStyle });
        name.anchor.set(0.5, 0);
        role.anchor.set(0.5, 1);
        task.anchor.set(0.5, 0);
        name.y = 40;
        role.y = -34;
        task.y = 58;
        root.addChild(shadow, ring, body, head, pip, orbit, name, role, task);
        root.on('pointertap', () => useFleet.getState().select(a.id));
        world.addChild(root);
        return { root, body, head, pip, ring, orbit, name, role, task };
      }

      function paint(s: SpriteRefs, a: Agent, now: number, selected: boolean) {
        const color = STATE_COLOR[a.state];
        const pulsing = a.state === 'thinking' || a.state === 'blocked';
        const pulse = pulsing ? 0.6 + 0.4 * Math.abs(Math.sin(now / 400)) : 1;
        const isSub = a.parentId != null;
        const scaleBase = isSub ? 0.82 : 1;

        // entrance pop
        const age = now - a.changedAt;
        const pop = a.state === 'spawning' && age < 300 ? 0.6 + 0.4 * (age / 300) : 1;
        s.root.scale.set(scaleBase * pop);

        s.body.clear().roundRect(-20, -6, 40, 40, 6).fill({ color, alpha: pulse });
        s.body.stroke({ width: 2, color: 0x0b0e12, alpha: 0.6 });
        s.head.clear().circle(0, -18, 12).fill({ color, alpha: pulse }).stroke({ width: 2, color: 0x0b0e12, alpha: 0.6 });

        s.pip.clear();
        if (a.state === 'tool') {
          // orbiting worker dot
          s.orbit.visible = true;
          const r = 30;
          s.orbit.x = Math.cos(now / 250) * r;
          s.orbit.y = -2 + Math.sin(now / 250) * r * 0.5;
          if (s.orbit.children.length === 0) s.orbit.addChild(new Graphics().circle(0, 0, 4).fill(0xfde68a));
        } else {
          s.orbit.visible = false;
        }

        s.ring.clear();
        if (selected) s.ring.roundRect(-26, -34, 52, 78, 10).stroke({ width: 2, color: 0x38bdf8, alpha: 0.9 });

        s.task.text = truncate(a.task, 22);
        s.task.style.fill = a.state === 'blocked' ? 0xfca5a5 : 0x64748b;
      }

      const ticker = () => {
        const { agents, order, selectedId } = fleetSnapshot();
        const pos = layout(agents, order);
        const now = performance.now();

        // reconcile
        for (const id of order) {
          const a = agents[id];
          if (!a) continue;
          let s = sprites.get(id);
          if (!s) {
            s = makeSprite(a);
            sprites.set(id, s);
          }
          s.name.text = a.name;
          s.role.text = a.role.toUpperCase();
          const p = pos[id];
          if (p) {
            // ease toward target
            s.root.x += (p.x - s.root.x) * 0.15 || 0;
            s.root.y += (p.y - s.root.y) * 0.15 || 0;
            if (s.root.x === 0 && s.root.y === 0) {
              s.root.x = p.x;
              s.root.y = p.y;
            }
          }
          paint(s, a, now, selectedId === id);
        }
      };
      app.ticker.add(ticker);
      cleanupTicker = () => app.ticker.remove(ticker);
    })();

    return () => {
      disposed = true;
      cleanupTicker?.();
      try {
        app.destroy(true, { children: true });
      } catch {
        /* not yet initialised */
      }
    };
  }, []);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
