// テキストページング処理クラス
export class TextPager {
  private pages: string[] = [];
  private currentPage: number = 0;
  private maxCharsPerPage: number = 150;

  constructor(text: string, maxCharsPerPage: number = 150) {
    this.maxCharsPerPage = maxCharsPerPage;
    this.splitIntoPages(text);
  }

  private splitIntoPages(text: string): void {
    this.pages = [];
    if (!text || text.trim().length === 0) {
      this.pages = [''];
      return;
    }

    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const paragraphs = cleanText.split('\n');
    
    let currentPage = '';
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      if (!paragraph) {
        if (currentPage) currentPage += '\n';
        continue;
      }

      if ((currentPage + paragraph).length <= this.maxCharsPerPage) {
        if (currentPage) currentPage += '\n';
        currentPage += paragraph;
      } else {
        if (currentPage) {
          this.pages.push(currentPage.trim());
          currentPage = '';
        }

        let remaining = paragraph;
        while (remaining.length > 0) {
          if (remaining.length <= this.maxCharsPerPage) {
            currentPage = remaining;
            remaining = '';
          } else {
            let splitIndex = this.maxCharsPerPage;
            const lastSpaceIndex = remaining.lastIndexOf(' ', this.maxCharsPerPage);
            if (lastSpaceIndex > this.maxCharsPerPage * 0.7) {
              splitIndex = lastSpaceIndex;
            }
            this.pages.push(remaining.substring(0, splitIndex).trim());
            remaining = remaining.substring(splitIndex).trim();
          }
        }
      }
    }

    if (currentPage) {
      this.pages.push(currentPage.trim());
    }

    if (this.pages.length === 0) {
      this.pages = [''];
    }
  }

  getCurrentPage(): string {
    return this.pages[this.currentPage] || '';
  }

  nextPage(): boolean {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      return true;
    }
    return false;
  }

  prevPage(): boolean {
    if (this.currentPage > 0) {
      this.currentPage--;
      return true;
    }
    return false;
  }

  getCurrentPageNumber(): number {
    return this.currentPage + 1;
  }

  getTotalPages(): number {
    return this.pages.length;
  }

  getPageInfo(): string {
    return `${this.getCurrentPageNumber()}/${this.getTotalPages()}`;
  }
}

