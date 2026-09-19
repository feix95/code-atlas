export function createRequestScope() {
  let generation = 0
  const lanes = new Map<string, number>()
  return {
    reset(): void {
      generation += 1
      lanes.clear()
    },
    begin(lane: string): () => boolean {
      const scope = generation
      const ticket = (lanes.get(lane) ?? 0) + 1
      lanes.set(lane, ticket)
      return () => scope === generation && lanes.get(lane) === ticket
    }
  }
}
