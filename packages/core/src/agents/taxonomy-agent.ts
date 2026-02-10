import OpenAI from 'openai';
import type { TaxonomyOverview } from '../planner/taxonomy-overview';
import type { TaxonomyPlan } from '../planner/taxonomy-types';
import {
  TAXONOMY_AGENT_SYSTEM_PROMPT,
  TAXONOMY_AGENT_USER_PROMPT,
} from './prompts/taxonomy-agent-prompt';
import type { WorkerPool } from './worker-pool';

function buildTrivialPlan(): TaxonomyPlan {
  return {
    folders: [
      {
        id: 'all-files',
        path: '/All Files',
        description: 'Fallback virtual folder that contains every file when no taxonomy is available.',
      },
    ],
    rules: [
      {
        id: 'catch-all',
        targetFolderId: 'all-files',
        requiredTags: [],
        forbiddenTags: [],
        pathContains: [],
        extensionIn: [],
        summaryContainsAny: [],
        priority: 1,
        reasonTemplate: 'Placed in /All Files by fallback taxonomy rule.',
      },
    ],
  };
}

export class TaxonomyAgent {
  private openai: OpenAI | null;
  private workerPool: WorkerPool | null;

  constructor(workerPool?: WorkerPool) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Make it very obvious in logs when we are NOT using the LLM
      console.warn(
        '[TaxonomyAgent] OPENAI_API_KEY is not set – using trivial /All Files taxonomy plan. ' +
          'Set OPENAI_API_KEY in the Electron main process environment to enable AI taxonomy.'
      );
      this.openai = null;
    } else {
      this.openai = new OpenAI({ apiKey });
    }
    this.workerPool = workerPool || null;
  }

  async generatePlan(overview: TaxonomyOverview): Promise<TaxonomyPlan> {
    if (!this.openai) {
      // No API key available – fall back to a simple, deterministic taxonomy
      return buildTrivialPlan();
    }

    const system = TAXONOMY_AGENT_SYSTEM_PROMPT;
    const user = TAXONOMY_AGENT_USER_PROMPT(overview);

    const apiCall = async (): Promise<TaxonomyPlan> => {
      try {
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });

        const raw = response.choices[0]?.message?.content?.trim() || '';

        if (!raw) {
          console.warn(
            '[TaxonomyAgent] Model returned empty content – falling back to trivial /All Files plan.'
          );
          return buildTrivialPlan();
        }

        const parsed = this.parsePlan(raw);
        if (!parsed) {
          console.warn(
            '[TaxonomyAgent] Failed to parse model response into TaxonomyPlan – falling back to trivial /All Files plan.\n' +
              `First 300 chars of response:\n${raw.slice(0, 300)}`
          );
          return buildTrivialPlan();
        }

        console.log(
          `[TaxonomyAgent] Successfully generated taxonomy with ${parsed.folders.length} folders and ${parsed.rules.length} rules.`
        );
        return parsed;
      } catch (error) {
        console.error(
          '[TaxonomyAgent] Error while calling OpenAI for taxonomy plan – falling back to trivial /All Files plan:',
          error
        );
        return buildTrivialPlan();
      }
    };

    return this.workerPool ? await this.workerPool.execute(apiCall) : await apiCall();
  }

  /**
   * Parse a model response into a TaxonomyPlan.
   * Handles optional markdown fences and validates basic structure.
   */
  private parsePlan(content: string): TaxonomyPlan | null {
    if (!content) return null;

    let jsonText = content.trim();

    // Strip markdown code fences if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```[a-zA-Z]*\s*/u, '');
      jsonText = jsonText.replace(/```$/u, '').trim();
    }

    // Heuristic: find first "{" and last "}" to isolate JSON object
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      console.warn(
        '[TaxonomyAgent] Could not find JSON object braces in model response when parsing TaxonomyPlan.'
      );
      return null;
    }
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);

    try {
      const value = JSON.parse(jsonText) as any;
      if (!value || typeof value !== 'object') return null;

      const folders = Array.isArray(value.folders) ? value.folders : [];
      const rules = Array.isArray(value.rules) ? value.rules : [];

      const plan: TaxonomyPlan = {
        folders: folders.map((f: any) => ({
          id: String(f.id),
          path: String(f.path),
          description: String(f.description ?? ''),
        })),
        rules: rules.map((r: any) => ({
          id: String(r.id),
          targetFolderId: String(r.targetFolderId),
          requiredTags: Array.isArray(r.requiredTags)
            ? r.requiredTags.map((t: any) => String(t))
            : undefined,
          forbiddenTags: Array.isArray(r.forbiddenTags)
            ? r.forbiddenTags.map((t: any) => String(t))
            : undefined,
          pathContains: Array.isArray(r.pathContains)
            ? r.pathContains.map((p: any) => String(p))
            : undefined,
          extensionIn: Array.isArray(r.extensionIn)
            ? r.extensionIn.map((e: any) => String(e).toLowerCase())
            : undefined,
          summaryContainsAny: Array.isArray(r.summaryContainsAny)
            ? r.summaryContainsAny.map((s: any) => String(s))
            : undefined,
          priority:
            typeof r.priority === 'number'
              ? r.priority
              : Number.parseInt(String(r.priority ?? '0'), 10) || 0,
          reasonTemplate: String(r.reasonTemplate ?? ''),
        })),
      };
      return plan;
    } catch (error) {
      console.error(
        '[TaxonomyAgent] JSON parse error while reading TaxonomyPlan from model response:',
        error
      );
      return null;
    }
  }
}

