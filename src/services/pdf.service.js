import { jsPDF } from 'jspdf';

class PDFService {
  generateSEOAuditReport(audit, user) {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('SEO Audit Report', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Powered by Serpixa', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`URL: ${audit.url}`, 20, y);
    y += 8;
    if (audit.keyword) {
      doc.text(`Target Keyword: ${audit.keyword}`, 20, y);
      y += 8;
    }
    doc.text(`Date: ${new Date(audit.createdAt).toLocaleDateString()}`, 20, y);
    y += 8;
    doc.text(`Generated for: ${user.name || user.email}`, 20, y);
    y += 15;

    // Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('SEO Score', 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.score)); 
    doc.text(`${audit.score}/100`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // On-Page Checks
    y = this.addSection(doc, 'On-Page Analysis', y);
    y = this.addCheck(doc, 'Title Tag', audit.checks.title, y);
    y = this.addCheck(doc, 'Meta Description', audit.checks.description, y);
    y = this.addCheck(doc, 'H1 Tag', audit.checks.h1, y);
    y = this.addCheck(doc, 'Canonical', audit.checks.canonical, y);
    y = this.addCheck(doc, 'Images', audit.checks.images, y);
    y = this.addCheck(doc, 'Links', audit.checks.links, y);
    y += 5;

    // Keyword Analysis
    if (audit.keywordAnalysis) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSection(doc, 'Keyword Analysis', y);
      const kw = audit.keywordAnalysis;
      y = this.addKeywordCheck(doc, 'In Title', kw.inTitle, y);
      y = this.addKeywordCheck(doc, 'In Description', kw.inDescription, y);
      y = this.addKeywordCheck(doc, 'In H1', kw.inH1, y);
      y = this.addKeywordCheck(doc, 'In Content', kw.inContent, y);
      y = this.addLine(doc, `Keyword Density: ${kw.density}%`, y);
      y = this.addLine(doc, `Occurrences: ${kw.occurrences}`, y);
      y += 5;
    }

    // Competitor Ranking Table
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSection(doc, 'Competitor Rankings', y);
      y = this.addCompetitorTable(doc, audit.competitors, y);
      y += 10;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, 'Recommendations', y);

      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 20);
        const priorityColor = rec.priority === 'high' ? [220, 53, 69] : rec.priority === 'medium' ? [255, 193, 7] : [40, 167, 69];
        doc.setFillColor(...priorityColor);
        doc.circle(25, y - 2, 2, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(rec.issue, 30, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        doc.text(rec.action, 30, y);
        doc.setTextColor(0);
        y += 10;
      }
    }

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      doc.text('serpixa.ai', pageWidth - 20, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
    }

    // Return as Uint8Array for better compatibility
    return doc.output('arraybuffer');
  }

  addSection(doc, title, y) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 20, y);
    doc.setLineWidth(0.5);
    doc.line(20, y + 2, 190, y + 2);
    return y + 12;
  }

  addCheck(doc, label, data, y) {
    y = this.checkPageBreak(doc, y, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 25, y);
    doc.setFont('helvetica', 'normal');

    if (data.exists !== undefined) {
      const status = data.exists ? 'Yes' : 'No';
      doc.setTextColor(data.exists ? 40 : 220, data.exists ? 167 : 53, data.exists ? 69 : 69);
      doc.text(status, 80, y);
      doc.setTextColor(0);
    }

    if (data.value) {
      const truncated = data.value.length > 50 ? data.value.substring(0, 50) + '...' : data.value;
      doc.text(truncated, 100, y);
    }

    if (data.count !== undefined) {
      doc.text(`Count: ${data.count}`, 100, y);
    }

    if (data.total !== undefined) {
      doc.text(`Total: ${data.total}, Without Alt: ${data.withoutAlt || 0}`, 100, y);
    }

    if (data.internal !== undefined) {
      doc.text(`Internal: ${data.internal}, External: ${data.external}, Broken: ${data.broken}`, 100, y);
    }

    return y + 8;
  }

  addKeywordCheck(doc, label, value, y) {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${label}:`, 25, y);
    doc.setTextColor(value ? 40 : 220, value ? 167 : 53, value ? 69 : 69);
    doc.text(value ? 'Yes' : 'No', 80, y);
    doc.setTextColor(0);
    return y + 7;
  }

  addLine(doc, text, y) {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.text(text, 25, y);
    return y + 7;
  }

  checkPageBreak(doc, y, needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      return 20;
    }
    return y;
  }

  getScoreColor(score) {
    if (score >= 80) return [40, 167, 69];
    if (score >= 50) return [255, 193, 7];
    return [220, 53, 69];
  }

  addCompetitorTable(doc, competitors, y) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const startX = 20;
    const colWidths = [15, 50, 60, 65]; // Position, Title, URL, Domain
    let currentY = y;

    // Table header
    doc.setFillColor(240, 240, 240);
    doc.rect(startX, currentY, pageWidth - 40, 10, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Pos', startX + 2, currentY + 7);
    doc.text('Title', startX + colWidths[0] + 2, currentY + 7);
    doc.text('URL', startX + colWidths[0] + colWidths[1] + 2, currentY + 7);
    doc.text('Domain', startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY + 7);
    currentY += 12;

    // Table rows (top 10 only)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const topCompetitors = competitors.slice(0, 10);
    
    for (const competitor of topCompetitors) {
      currentY = this.checkPageBreak(doc, currentY, 15);
      
      // Position
      doc.setFont('helvetica', 'bold');
      doc.text(`${competitor.position}`, startX + 2, currentY);
      
      // Title (truncated)
      doc.setFont('helvetica', 'normal');
      const title = competitor.title.length > 40 ? competitor.title.substring(0, 37) + '...' : competitor.title;
      doc.text(title, startX + colWidths[0] + 2, currentY, { maxWidth: colWidths[1] - 4 });
      
      // URL (truncated)
      const url = competitor.url.length > 45 ? competitor.url.substring(0, 42) + '...' : competitor.url;
      doc.text(url, startX + colWidths[0] + colWidths[1] + 2, currentY, { maxWidth: colWidths[2] - 4 });
      
      // Domain
      doc.text(competitor.domain || '', startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY, { maxWidth: colWidths[3] - 4 });
      
      currentY += 10;
    }

    return currentY;
  }

  generateGBPAuditReport(audit, user) {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;
  
    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('GBP Audit Report', pageWidth / 2, y, { align: 'center' });
    y += 15;
  
    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Powered by Serpixa', pageWidth / 2, y, { align: 'center' });
    y += 15;
  
    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`Business: ${audit.businessName}`, 20, y);
    y += 8;
    doc.text(`Date: ${new Date(audit.createdAt).toLocaleDateString()}`, 20, y);
    y += 8;
    doc.text(`Generated for: ${user.name || user.email}`, 20, y);
    y += 15;
  
    // Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Completeness Score', 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.score));
    doc.text(`${audit.score}%`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;
  
    // Business Information
    if (audit.businessInfo) {
      y = this.addSection(doc, 'Business Information', y);
      const info = audit.businessInfo;
      if (info.name) y = this.addInfoLine(doc, 'Name', info.name, y);
      if (info.address) y = this.addInfoLine(doc, 'Address', info.address, y);
      if (info.phone) y = this.addInfoLine(doc, 'Phone', info.phone, y);
      if (info.website) y = this.addInfoLine(doc, 'Website', info.website, y);
      if (info.category) y = this.addInfoLine(doc, 'Category', info.category, y);
      if (info.rating) y = this.addInfoLine(doc, 'Rating', `${info.rating}/5 (${info.reviewCount} reviews)`, y);
      y += 5;
    }
  
    // Completeness Checklist
    if (audit.checklist?.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSection(doc, 'Profile Checklist', y);
      y = this.addGBPChecklist(doc, audit.checklist, y);
      y += 5;
    }
  
    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, 'Recommendations', y);
  
      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 20);
        const priorityColor = rec.priority === 'high' ? [220, 53, 69] : rec.priority === 'medium' ? [255, 193, 7] : [40, 167, 69];
        doc.setFillColor(...priorityColor);
        doc.circle(25, y - 2, 2, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(rec.issue, 30, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        const actionLines = doc.splitTextToSize(rec.action, 155);
        doc.text(actionLines, 30, y);
        doc.setTextColor(0);
        y += actionLines.length * 5 + 5;
      }
    }
  
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      doc.text('serpixa.ai', pageWidth - 20, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
    }
  
    return doc.output('arraybuffer');
  }
  
  addInfoLine(doc, label, value, y) {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 25, y);
    doc.setFont('helvetica', 'normal');
    const truncated = value.length > 60 ? value.substring(0, 57) + '...' : value;
    doc.text(truncated, 70, y);
    return y + 7;
  }
  
  addGBPChecklist(doc, checklist, y) {
    for (const item of checklist) {
      y = this.checkPageBreak(doc, y, 10);
      
      // Checkbox
      doc.setDrawColor(150);
      doc.rect(25, y - 4, 4, 4);
      if (item.completed) {
        doc.setFillColor(40, 167, 69);
        doc.rect(25.5, y - 3.5, 3, 3, 'F');
      }
      
      // Label
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(item.completed ? 0 : 100);
      doc.text(item.label, 32, y);
      
      // Value
      if (item.value) {
        doc.setTextColor(80);
        const valueStr = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
        const truncated = valueStr.length > 40 ? valueStr.substring(0, 37) + '...' : valueStr;
        doc.text(truncated, 120, y);
      }
      
      doc.setTextColor(0);
      y += 8;
    }
    return y;
  }

}

export const pdfService = new PDFService();