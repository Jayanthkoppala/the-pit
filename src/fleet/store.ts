import { create } from 'zustand';
import type { Agent, FleetEvent } from './types';

interface FleetStore {
  agents: Record<string, Agent>;
  order: string[]; // stable spawn order, for layout
  selectedId: string | null;
  sourceLabel: string;
  apply: (e: FleetEvent) => void;
  select: (id: string | null) => void;
  setSourceLabel: (label: string) => void;
}

export const useFleet = create<FleetStore>((set) => ({
  agents: {},
  order: [],
  selectedId: null,
  sourceLabel: '—',

  apply: (e) =>
    set((s) => {
      const agents = { ...s.agents };
      let order = s.order;

      switch (e.kind) {
        case 'spawn': {
          if (!agents[e.id]) order = [...order, e.id];
          agents[e.id] = {
            id: e.id,
            parentId: e.parentId,
            name: e.name,
            role: e.role,
            state: 'spawning',
            task: e.task,
            toolCalls: 0,
            tokens: 0,
            changedAt: e.at,
          };
          break;
        }
        case 'state': {
          const a = agents[e.id];
          if (a) agents[e.id] = { ...a, state: e.state, task: e.task ?? a.task, changedAt: e.at };
          break;
        }
        case 'tool': {
          const a = agents[e.id];
          if (a) agents[e.id] = { ...a, toolCalls: a.toolCalls + 1, tokens: a.tokens + (e.tokens ?? 0), changedAt: e.at };
          break;
        }
        case 'tokens': {
          const a = agents[e.id];
          if (a) agents[e.id] = { ...a, tokens: a.tokens + e.delta };
          break;
        }
        case 'despawn': {
          // keep completed/failed agents on the floor; despawn only clears live ones.
          break;
        }
      }
      return { agents, order };
    }),

  select: (id) => set({ selectedId: id }),
  setSourceLabel: (label) => set({ sourceLabel: label }),
}));

/** Non-hook accessor for the render loop (avoids re-subscribing every frame). */
export const fleetSnapshot = () => useFleet.getState();
