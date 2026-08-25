import { localRepository } from "../database/localRepository";
import { knowledgeExtractionService } from "./knowledgeExtractionService";
import { graphService } from "./graphService";
import type { Paper } from "../types/athena";

export const paperService = {
  async savePaper(paper: Paper): Promise<Paper> {
    const saved = await localRepository.savePaper(paper);
    const library = await localRepository.loadPapers();
    await graphService.saveGraph(knowledgeExtractionService.createLibraryGraph(library));
    return saved;
  },

  async loadPaper(id: string): Promise<Paper | undefined> {
    const papers = await this.loadLibrary();
    return papers.find((paper) => paper.id === id);
  },

  async loadLibrary(): Promise<Paper[]> {
    return localRepository.loadPapers();
  },

  async deletePaper(id: string): Promise<Paper[]> {
    await localRepository.deletePaper(id);
    const library = await localRepository.loadPapers();
    await graphService.saveGraph(knowledgeExtractionService.createLibraryGraph(library));
    return library;
  },
};
