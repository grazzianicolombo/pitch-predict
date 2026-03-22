import { create } from 'zustand'
import { pitchAPI, predictionAPI } from '../services/api'

export const usePitchStore = create((set) => ({
  pitches: [],
  predictions: [],
  loading: false,
  error: null,
  selectedPitch: null,

  fetchPitches: async () => {
    set({ loading: true, error: null })
    try {
      const { data } = await pitchAPI.getAll()
      set({ pitches: data.data || [], loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },

  createPitch: async (pitchData) => {
    set({ loading: true, error: null })
    try {
      const { data } = await pitchAPI.create(pitchData)
      set((state) => ({
        pitches: [...state.pitches, data.data],
        loading: false
      }))
      return data.data
    } catch (error) {
      set({ error: error.message, loading: false })
      throw error
    }
  },

  createPrediction: async (pitch) => {
    set({ loading: true, error: null })
    try {
      const { data } = await predictionAPI.create({ pitch })
      set((state) => ({
        predictions: [data.data, ...state.predictions],
        loading: false
      }))
      return data.data
    } catch (error) {
      set({ error: error.message, loading: false })
      throw error
    }
  },

  fetchPredictions: async () => {
    set({ loading: true, error: null })
    try {
      const { data } = await predictionAPI.getAll()
      set({ predictions: data.data || [], loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },

  setSelectedPitch: (pitch) => set({ selectedPitch: pitch }),
  clearError: () => set({ error: null })
}))

export default usePitchStore
