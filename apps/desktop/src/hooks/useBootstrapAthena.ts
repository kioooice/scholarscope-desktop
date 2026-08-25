import { useEffect } from "react";
import { localRepository } from "../database/localRepository";
import { knowledgeExtractionService } from "../services/knowledgeExtractionService";
import { useAthenaStore } from "../stores/athenaStore";

export function useBootstrapAthena() {
  const setLibrary = useAthenaStore((state) => state.setLibrary);
  const setGraph = useAthenaStore((state) => state.setGraph);
  const setNotes = useAthenaStore((state) => state.setNotes);
  const setStatusMessage = useAthenaStore((state) => state.setStatusMessage);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await localRepository.initialize();
        const [papers, graph, notes] = await Promise.all([
          localRepository.loadPapers(),
          localRepository.loadGraph(),
          localRepository.loadNotes(),
        ]);
        if (cancelled) return;
        const paperOnlyGraph = papers.length ? await localRepository.saveGraph(knowledgeExtractionService.createLibraryGraph(papers)) : graph;
        setLibrary(papers);
        setGraph(paperOnlyGraph);
        setNotes(notes);
        setStatusMessage("Local knowledge base loaded");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Athena failed to initialize");
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [setGraph, setLibrary, setNotes, setStatusMessage]);
}
