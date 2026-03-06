import { create } from 'zustand';
import { FlowPlan, FlowStage, FlowStageStatus } from '../core/types';

interface FlowStore {
  // Active flow
  activePlan: FlowPlan | null;
  setActivePlan: (plan: FlowPlan | null) => void;

  // Stage control
  updateStageStatus: (stageId: string, status: FlowStageStatus, output?: string, error?: string) => void;
  approveStage: (stageId: string) => void;
  rejectStage: (stageId: string) => void;

  // History
  completedFlows: FlowPlan[];
  archiveFlow: (plan: FlowPlan) => void;

  // UI state
  isInterpreting: boolean;
  setInterpreting: (v: boolean) => void;
  currentStageIndex: number;
  setCurrentStageIndex: (i: number) => void;
}

export const useFlowStore = create<FlowStore>((set, get) => ({
  activePlan: null,
  setActivePlan: (plan) => set({ activePlan: plan, currentStageIndex: 0 }),

  updateStageStatus: (stageId, status, output, error) => set(state => {
    if (!state.activePlan) return state;
    return {
      activePlan: {
        ...state.activePlan,
        stages: state.activePlan.stages.map(s =>
          s.id === stageId
            ? { ...s, status, output: output ?? s.output, errorMsg: error ?? s.errorMsg,
                startedAt: status === 'running' ? new Date().toISOString() : s.startedAt,
                completedAt: ['completed','error','skipped'].includes(status) ? new Date().toISOString() : s.completedAt }
            : s
        )
      }
    };
  }),

  approveStage: (stageId) => set(state => {
    if (!state.activePlan) return state;
    return {
      activePlan: {
        ...state.activePlan,
        stages: state.activePlan.stages.map(s =>
          s.id === stageId ? { ...s, status: 'approved' as FlowStageStatus } : s
        )
      }
    };
  }),

  rejectStage: (stageId) => set(state => {
    if (!state.activePlan) return state;
    return {
      activePlan: {
        ...state.activePlan,
        status: 'paused',
        stages: state.activePlan.stages.map(s =>
          s.id === stageId ? { ...s, status: 'rejected' as FlowStageStatus } : s
        )
      }
    };
  }),

  completedFlows: [],
  archiveFlow: (plan) => set(state => ({
    completedFlows: [{ ...plan, status: 'completed', completedAt: new Date().toISOString() }, ...state.completedFlows],
    activePlan: null,
  })),

  isInterpreting: false,
  setInterpreting: (v) => set({ isInterpreting: v }),
  currentStageIndex: 0,
  setCurrentStageIndex: (i) => set({ currentStageIndex: i }),
}));
