/**
 * TextRank 中文文本摘要
 * 无外部依赖，基于字符级 TF + 余弦相似度 + PageRank 迭代
 */

function buildTF(sentence: string): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const ch of sentence) {
    if (/[\u4e00-\u9fa5a-zA-Z0-9]/.test(ch)) {
      freq[ch] = (freq[ch] || 0) + 1;
    }
  }
  return freq;
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, normA = 0, normB = 0;
  for (const k of keys) {
    dot += (a[k] || 0) * (b[k] || 0);
    normA += (a[k] || 0) ** 2;
    normB += (b[k] || 0) ** 2;
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

/**
 * 用 TextRank 提取文本摘要
 * @param text 原始文本（支持中文，4000-5000字以内效果佳）
 * @param topN 提取句子数，默认2句
 * @param maxLen 最终摘要最大字符数，默认150
 */
export function textRankSummarize(text: string, topN = 2, maxLen = 150): string {
  const sentences = text
    .replace(/[#*`>【】「」『』]/g, '')
    .split(/(?<=[。！？\n])/)
    .map(s => s.trim())
    .filter(s => s.length > 8);

  if (sentences.length === 0) return text.substring(0, maxLen);
  if (sentences.length <= topN) return sentences.join('').substring(0, maxLen);

  const tf = sentences.map(buildTF);
  const n = sentences.length;

  // 构建相似度矩阵
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => i === j ? 0 : cosineSimilarity(tf[i], tf[j]))
  );

  // TextRank 迭代（15次足够收敛）
  const d = 0.85;
  let scores = new Array(n).fill(1 / n);
  for (let iter = 0; iter < 15; iter++) {
    scores = scores.map((_, i) => {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        const colSum = matrix[j].reduce((a, b) => a + b, 0);
        if (colSum > 0) sum += (matrix[j][i] / colSum) * scores[j];
      }
      return (1 - d) / n + d * sum;
    });
  }

  // 取分数最高的 topN 句，按原文顺序输出
  const result = scores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .sort((a, b) => a.i - b.i)
    .map(r => sentences[r.i])
    .join('');

  return result.substring(0, maxLen);
}
