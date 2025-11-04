// マークダウンテキストを整形するクラス（プレーンテキストに変換）
export class MarkdownFormatter {
  static format(text: string): string {
    let formatted = text;
    
    // コードブロックをそのまま保持（```で囲まれた部分）
    const codeBlocks: string[] = [];
    formatted = formatted.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });
    
    // インラインコードをそのまま保持
    const inlineCodes: string[] = [];
    formatted = formatted.replace(/`[^`]+`/g, (match) => {
      inlineCodes.push(match);
      return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });
    
    // 見出し (# ## ###) → 見出しテキストの前に空行と記号を追加
    formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, (match) => {
      const hashMatch = match.match(/^#+/);
      if (!hashMatch) return match;
      const level = hashMatch[0].length;
      const text = match.replace(/^#+\s+/, '').trim();
      const prefix = level === 1 ? '═══════════════════════\n' : level === 2 ? '───────────────────────\n' : '━━━━━━━━━━━━━━━━━━━━━━\n';
      return `\n${prefix}${text}\n${prefix}\n`;
    });
    
    // 太字 (**text** または __text__) → 構文を削除してテキストのみ
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '$1');
    formatted = formatted.replace(/__(.+?)__/g, '$1');
    
    // 斜体 (*text* または _text_) → 構文を削除してテキストのみ
    formatted = formatted.replace(/\*(.+?)\*/g, '$1');
    formatted = formatted.replace(/_(.+?)_/g, '$1');
    
    // 取り消し線 (~~text~~) → 構文を削除
    formatted = formatted.replace(/~~(.+?)~~/g, '$1');
    
    // リンク [text](url) → text (url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    
    // 画像 ![alt](url) → [画像: alt]
    formatted = formatted.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[画像: $1]');
    
    // リスト (- または *) → • に統一（インデントを考慮）
    formatted = formatted.replace(/^(\s*)[\-\*]\s+(.+)$/gm, (match, indent, text) => {
      return `${indent}• ${text}`;
    });
    // 番号付きリスト → 番号を削除（インデントを考慮）
    formatted = formatted.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1$2');
    
    // 水平線 (--- または ***) → 削除
    formatted = formatted.replace(/^[-*]{3,}$/gm, '');
    
    // 引用 (> text) → "text" に変換
    formatted = formatted.replace(/^>\s+(.+)$/gm, '"$1"');
    
    // テーブル形式を簡略化（| で区切られた行）
    formatted = formatted.replace(/^\|(.+)\|$/gm, (match, content) => {
      // ヘッダー行の後の区切り線を削除
      if (content.trim().match(/^:?-+:?$/)) {
        return '';
      }
      // テーブルセルをスペースで区切る
      return content.split('|').map((cell: string) => cell.trim()).filter((cell: string) => cell).join(' | ');
    });
    
    // コードブロックを復元
    codeBlocks.forEach((code, index) => {
      formatted = formatted.replace(`__CODE_BLOCK_${index}__`, code);
    });
    
    // インラインコードを復元
    inlineCodes.forEach((code, index) => {
      formatted = formatted.replace(`__INLINE_CODE_${index}__`, code);
    });
    
    // 連続する空行を2つまでに制限
    formatted = formatted.replace(/\n{4,}/g, '\n\n\n');
    
    return formatted.trim();
  }
}

