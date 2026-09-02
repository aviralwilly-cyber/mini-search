export interface Suggestion {
  word: string;
  weight: number;
}

class TrieNode {
  children = new Map<string, TrieNode>();
  /** document frequency of the word ending here; 0 means this is not a word */
  weight = 0;
  /** best completions in this node's subtree, filled in by finalize() */
  top: Suggestion[] = [];
}

export class Trie {
  private static readonly TOP_K = 10;

  private root = new TrieNode();
  private size = 0;
  private finalized = false;

  insert(word: string, weight = 1): void {
    let node = this.root;
    for (const ch of word) {
      let next = node.children.get(ch);
      if (!next) {
        next = new TrieNode();
        node.children.set(ch, next);
      }
      node = next;
    }
    // only count the first time a word is seen — repeat inserts add weight
    if (node.weight === 0) this.size++;
    node.weight += weight;
    this.finalized = false;
  }

  get wordCount(): number {
    return this.size;
  }

  /**
   * Precompute the best completions at every node, bottom-up.
   *
   * The key insight: a node only needs its children's top-K, not their full
   * subtrees. If a word didn't make a child's top-K it cannot make the
   * parent's, so each merge is bounded by (childCount * K) rather than by
   * subtree size. This turns lookup from "walk the whole subtree" into a
   * plain array read.
   */
  finalize(): void {
    const walk = (node: TrieNode, path: string): Suggestion[] => {
      const candidates: Suggestion[] = [];
      if (node.weight > 0) candidates.push({ word: path, weight: node.weight });

      for (const [ch, child] of node.children) {
        candidates.push(...walk(child, path + ch));
      }

      candidates.sort((a, b) => b.weight - a.weight);
      node.top = candidates.slice(0, Trie.TOP_K);
      return node.top;
    };

    walk(this.root, "");
    this.finalized = true;
  }

  /**
   * O(prefix length). Costs the same for "a" as for "google" — no traversal.
   * Capped at TOP_K results regardless of the limit requested.
   */
  complete(prefix: string, limit = 8): Suggestion[] {
    if (!this.finalized) this.finalize();

    let node = this.root;
    for (const ch of prefix) {
      const next = node.children.get(ch);
      if (!next) return [];
      node = next;
    }
    return node.top.slice(0, limit);
  }

  /**
   * Original implementation: descend to the prefix, then enumerate the whole
   * subtree. Kept so tests can assert the fast path returns identical results,
   * and so the benchmark has something to compare against.
   *
   * maxVisited bounds the pathological case — a single-character prefix sits
   * above a subtree holding a large share of the vocabulary.
   */
  completeSlow(prefix: string, limit = 8, maxVisited = 20_000): Suggestion[] {
    let node = this.root;
    for (const ch of prefix) {
      const next = node.children.get(ch);
      if (!next) return [];
      node = next;
    }

    const out: Suggestion[] = [];
    let visited = 0;
    // explicit stack rather than recursion: depth is bounded by term length
    // here, but an iterative walk costs nothing and cannot blow the stack
    const stack: { node: TrieNode; suffix: string }[] = [{ node, suffix: "" }];

    while (stack.length > 0) {
      const { node: n, suffix } = stack.pop()!;
      if (++visited > maxVisited) break;

      if (n.weight > 0) out.push({ word: prefix + suffix, weight: n.weight });

      for (const [ch, child] of n.children) {
        stack.push({ node: child, suffix: suffix + ch });
      }
    }

    out.sort((a, b) => b.weight - a.weight);
    return out.slice(0, limit);
  }
}

export function buildTrie(terms: Iterable<[string, number]>): Trie {
  const trie = new Trie();
  for (const [term, weight] of terms) trie.insert(term, weight);
  trie.finalize();
  return trie;
}