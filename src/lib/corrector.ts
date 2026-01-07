import { get } from 'fast-levenshtein';
import { CIGARETTE_DB } from './cigarette-dict';

export type CorrectionResult = {
  original: string;
  corrected: string;
  isModified: boolean;
  confidence: 'high' | 'medium' | 'low';
};

// 【新增】自定义别名映射表
// 专门解决 OCR 容易识别错，但编辑距离算法又难以区分的词
// 格式: { "OCR错误识别的词": "正确的字典词" }
const CUSTOM_ALIASES: Record<string, string> = {
  "冰香": "冰雪",      // 你的案例
"奥获大熊猫": "典藏大熊猫",
  // 你可以在这里无限添加你发现的错误案例
  "日期" : ""
};

export function correctCigaretteName(scannedName: string): CorrectionResult {
  // 0. 【预处理】去除干扰字符
  // 有时候 OCR 会把 "软白沙." 识别成 "软白沙"，末尾的杂质要去掉
  const cleanName = scannedName.replace(/[._\-~]$/, '');

  // 1. 【最高优先级】查别名表
  // 如果这个词在我们的“纠错黑名单”里，直接按我们规定的改，不讲道理
  if (CUSTOM_ALIASES[cleanName]) {
    return {
      original: scannedName,
      corrected: CUSTOM_ALIASES[cleanName],
      isModified: true,
      confidence: 'high'
    };
  }

  // 2. 【次优先级】完全匹配
  if (CIGARETTE_DB.includes(cleanName)) {
    return {
      original: scannedName,
      corrected: cleanName,
      isModified: false,
      confidence: 'high'
    };
  }

  let bestMatch = cleanName;
  let minDistance = 999;

  // 3. 模糊匹配 (Levenshtein Distance)
  for (const standardName of CIGARETTE_DB) {
    // 长度差异太大直接跳过，提升性能
    if (Math.abs(cleanName.length - standardName.length) > 2) continue;

    const distance = get(cleanName, standardName);

    // 优化：如果距离一样，优先选择长度更接近的，或者包含原词更多字符的
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = standardName;
    }
  }

  // 4. 动态阈值判定
  let shouldCorrect = false;

  // 规则 A: 短词 (<= 3字) 必须极度相似 (距离<=1)
  if (cleanName.length <= 3) {
    if (minDistance <= 1) shouldCorrect = true;
  }
  // 规则 B: 中长词 (允许错 1-2 字，取决于长度)
  else {
    // 比如 4-5 个字的词，允许错 1 个
    // 6 个字以上允许错 2 个
    const threshold = cleanName.length > 5 ? 2 : 1;
    if (minDistance <= threshold) shouldCorrect = true;
  }

  if (shouldCorrect) {
    return {
      original: scannedName,
      corrected: bestMatch,
      isModified: true,
      confidence: 'medium'
    };
  }

  // 5. 无法纠错，原样返回
  return {
    original: scannedName,
    corrected: cleanName,
    isModified: false,
    confidence: 'low'
  };
}