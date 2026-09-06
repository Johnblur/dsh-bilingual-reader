// src/shared/domainSeed.ts — seed domain graph (DAG) + seed term glossary (zh).
// Provides a working baseline so the translator is useful on first install.
// Language granularity: zh (per decision). Entries carry en+zh peer forms.
import type { DomainGraph, TermEntry } from './domain.js';

export const SEED_GRAPH: DomainGraph = {
  roots: ['computer-science', 'biology', 'physics'],
  edges: {
    'computer-science': ['machine-learning', 'computer-vision', 'nlp', 'software-engineering', 'math'],
    'machine-learning': ['deep-learning', 'reinforcement-learning'],
    'deep-learning': ['nlp', 'computer-vision'],           // nlp/cv 多父（交叉）
    'biology': ['bioinformatics', 'genetics'],
    'bioinformatics': ['machine-learning'],                // 交叉：bioinformatics 也用 ML
    'physics': ['quantum-computing'],
    'quantum-computing': ['machine-learning'],
  },
};

const now = Date.now();
const t = (
  id: string,
  en: string,
  zh: string,
  domains: string[],
  conf = 0.9,
  source: TermEntry['source'] = 'seed',
): TermEntry => ({
  id, domains, terms: { en, zh }, confidence: conf, confirmedByUser: false, source, firstSeen: now,
});

export const SEED_TERMS: TermEntry[] = [
  // ── ML / deep learning common ──
  t('t_attention', 'attention', '注意力机制', ['machine-learning', 'deep-learning', 'nlp']),
  t('t_loss', 'loss', '损失', ['machine-learning', 'deep-learning']),
  t('t_gradient', 'gradient', '梯度', ['machine-learning', 'deep-learning']),
  t('t_backprop', 'backpropagation', '反向传播', ['machine-learning', 'deep-learning']),
  t('t_overfit', 'overfitting', '过拟合', ['machine-learning', 'deep-learning']),
  t('t_regularization', 'regularization', '正则化', ['machine-learning', 'deep-learning']),
  t('t_embedding', 'embedding', '嵌入', ['machine-learning', 'deep-learning', 'nlp']),
  t('t_token', 'token', '词元', ['nlp', 'machine-learning']),
  t('t_transformer', 'transformer', 'Transformer', ['nlp', 'machine-learning', 'deep-learning']),
  t('t_dataset', 'dataset', '数据集', ['machine-learning']),
  t('t_epoch', 'epoch', '轮次', ['machine-learning']),
  t('t_parameter', 'parameter', '参数', ['machine-learning', 'math']),

  // ── NLP ──
  t('t_corpus', 'corpus', '语料库', ['nlp']),
  t('t_lemma', 'lemmatization', '词形还原', ['nlp']),
  t('t_stem', 'stemming', '词干提取', ['nlp']),

  // ── CV ──
  t('t_backbone', 'backbone', '骨干网络', ['computer-vision', 'deep-learning']),
  t('t_iou', 'IoU', '交并比', ['computer-vision']),
  t('t_anchor', 'anchor box', '锚框', ['computer-vision']),
  t('t_augmentation', 'data augmentation', '数据增强', ['computer-vision', 'deep-learning']),

  // ── same word, different meaning across domains (separate entries) ──
  t('t_cell_bio', 'cell', '细胞', ['biology', 'genetics']),
  t('t_cell_cv', 'cell', '单元（网络单元）', ['computer-vision', 'deep-learning']),

  // ── RL ──
  t('t_policy', 'policy', '策略', ['reinforcement-learning', 'machine-learning']),
  t('t_reward', 'reward', '奖励', ['reinforcement-learning', 'machine-learning']),
  t('t_agent', 'agent', '智能体/代理', ['reinforcement-learning', 'machine-learning']),

  // ── biology / genetics ──
  t('t_genome', 'genome', '基因组', ['biology', 'genetics']),
  t('t_gene', 'gene', '基因', ['biology', 'genetics']),
  t('t_protein', 'protein', '蛋白质', ['biology']),
  t('t_sequence', 'sequence', '序列', ['biology', 'bioinformatics']),

  // ── physics / quantum ──
  t('t_qubit', 'qubit', '量子比特', ['quantum-computing', 'physics']),
  t('t_superposition', 'superposition', '叠加态', ['quantum-computing', 'physics']),
  t('t_entanglement', 'entanglement', '纠缠', ['quantum-computing', 'physics']),

  // ── software engineering / math (universal-ish, multi-domain) ──
  t('t_api', 'API', '应用程序接口', ['software-engineering', 'computer-science']),
  t('t_compile', 'compile', '编译', ['software-engineering']),
  t('t_runtime', 'runtime', '运行时', ['software-engineering']),
  t('t_convergence', 'convergence', '收敛', ['math', 'machine-learning']),
  t('t_matrix', 'matrix', '矩阵', ['math']),
];
