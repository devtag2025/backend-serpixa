import { jsPDF } from 'jspdf';
import { t } from '../locales/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';

class PDFService {
  getLanguageFromAudit(audit) {
    const locale = audit.locale || DEFAULT_LOCALE;
    const localeConfig = getLocaleConfig(locale);
    return localeConfig.language || 'en';
  }

  generateSEOAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.seo.title'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(t(lang, 'pdf.seo.poweredBy'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`${t(lang, 'pdf.seo.url')}: ${audit.url}`, 20, y);
    y += 8;
    if (audit.keyword) {
      doc.text(`${t(lang, 'pdf.seo.targetKeyword')}: ${audit.keyword}`, 20, y);
      y += 8;
    }
    doc.text(`${t(lang, 'pdf.seo.date')}: ${new Date(audit.createdAt).toLocaleDateString()}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.seo.generatedFor')}: ${user.name || user.email}`, 20, y);
    y += 15;

    // Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.seo.score'), 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.score));
    doc.text(`${audit.score}/100`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // On-Page Checks
    y = this.addSection(doc, t(lang, 'pdf.seo.onPageAnalysis'), y);
    y = this.addCheck(doc, audit.checks.title?.label || t(lang, 'seo.checks.title'), audit.checks.title, y, lang);
    y = this.addCheck(doc, audit.checks.description?.label || t(lang, 'seo.checks.description'), audit.checks.description, y, lang);
    y = this.addCheck(doc, audit.checks.h1?.label || t(lang, 'seo.checks.h1'), audit.checks.h1, y, lang);
    y = this.addCheck(doc, audit.checks.canonical?.label || t(lang, 'seo.checks.canonical'), audit.checks.canonical, y, lang);
    y = this.addCheck(doc, audit.checks.images?.label || t(lang, 'seo.checks.images'), audit.checks.images, y, lang);
    y = this.addCheck(doc, audit.checks.links?.label || t(lang, 'seo.checks.links'), audit.checks.links, y, lang);
    y += 5;

    // Keyword Analysis
    if (audit.keywordAnalysis) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSection(doc, audit.keywordAnalysis.title || t(lang, 'pdf.seo.keywordAnalysis'), y);
      const kw = audit.keywordAnalysis;
      y = this.addKeywordCheck(doc, kw.inTitleLabel || t(lang, 'seo.keywordAnalysis.inTitle'), kw.inTitle, y, lang);
      y = this.addKeywordCheck(doc, kw.inDescriptionLabel || t(lang, 'seo.keywordAnalysis.inDescription'), kw.inDescription, y, lang);
      y = this.addKeywordCheck(doc, kw.inH1Label || t(lang, 'seo.keywordAnalysis.inH1'), kw.inH1, y, lang);
      y = this.addKeywordCheck(doc, kw.inContentLabel || t(lang, 'seo.keywordAnalysis.inContent'), kw.inContent, y, lang);
      y = this.addLine(doc, `${kw.densityLabel || t(lang, 'pdf.seo.keywordDensity')}: ${kw.density}%`, y);
      y = this.addLine(doc, `${kw.occurrencesLabel || t(lang, 'pdf.seo.occurrences')}: ${kw.occurrences}`, y);
      y += 5;
    }

    // Competitor Ranking Table
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSection(doc, t(lang, 'pdf.seo.competitorRankings'), y);
      y = this.addCompetitorTable(doc, audit.competitors, y, lang);
      y += 10;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, t(lang, 'pdf.seo.recommendations'), y);

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
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }

  generateGBPAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.gbp.title'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(t(lang, 'pdf.gbp.poweredBy'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`${t(lang, 'pdf.gbp.business')}: ${audit.businessName}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.gbp.date')}: ${new Date(audit.createdAt).toLocaleDateString()}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.gbp.generatedFor')}: ${user.name || user.email}`, 20, y);
    y += 15;

    // Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(audit.scoreLabel || t(lang, 'pdf.gbp.completenessScore'), 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.score));
    doc.text(`${audit.score}%`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // Business Information
    if (audit.businessInfo) {
      y = this.addSection(doc, audit.businessInfoLabel || t(lang, 'pdf.gbp.businessInfo'), y);
      const info = audit.businessInfo;
      if (info.name) y = this.addInfoLine(doc, info.nameLabel || t(lang, 'pdf.gbp.name'), info.name, y);
      if (info.address) y = this.addInfoLine(doc, info.addressLabel || t(lang, 'pdf.gbp.address'), info.address, y);
      if (info.phone) y = this.addInfoLine(doc, info.phoneLabel || t(lang, 'pdf.gbp.phone'), info.phone, y);
      if (info.website) y = this.addInfoLine(doc, info.websiteLabel || t(lang, 'pdf.gbp.website'), info.website, y);
      if (info.category) y = this.addInfoLine(doc, info.categoryLabel || t(lang, 'pdf.gbp.category'), info.category, y);
      if (info.rating) y = this.addInfoLine(doc, info.ratingLabel || t(lang, 'pdf.gbp.rating'), `${info.rating}/5 (${info.reviewCount} ${t(lang, 'pdf.gbp.reviews')})`, y);
      y += 5;
    }

    // Completeness Checklist
    if (audit.checklist?.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSection(doc, audit.checklistLabel || t(lang, 'pdf.gbp.profileChecklist'), y);
      y = this.addGBPChecklist(doc, audit.checklist, y);
      y += 5;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, t(lang, 'pdf.gbp.recommendations'), y);

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
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }

  generateGeoAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.geo.title'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(t(lang, 'pdf.geo.poweredBy'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`${t(lang, 'pdf.geo.business')}: ${audit.businessName}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.keyword')}: ${audit.keyword}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.location')}: ${audit.location}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.date')}: ${new Date(audit.createdAt).toLocaleDateString()}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.generatedFor')}: ${user.name || user.email}`, 20, y);
    y += 15;

    // Local Visibility Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(audit.localVisibilityScoreLabel || t(lang, 'pdf.geo.localVisibilityScore'), 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.localVisibilityScore));
    doc.text(`${audit.localVisibilityScore}/100`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // Business Information
    if (audit.businessInfo) {
      y = this.addSection(doc, audit.businessInfoLabel || t(lang, 'pdf.geo.businessInfo'), y);
      const info = audit.businessInfo;
      if (info.name) y = this.addInfoLine(doc, info.nameLabel || t(lang, 'pdf.geo.name'), info.name, y);
      if (info.address) y = this.addInfoLine(doc, info.addressLabel || t(lang, 'pdf.geo.address'), info.address, y);
      if (info.phone) y = this.addInfoLine(doc, info.phoneLabel || t(lang, 'pdf.geo.phone'), info.phone, y);
      if (info.website) y = this.addInfoLine(doc, info.websiteLabel || t(lang, 'pdf.geo.website'), info.website, y);
      if (info.category) y = this.addInfoLine(doc, info.categoryLabel || t(lang, 'pdf.geo.category'), info.category, y);
      if (info.rating) y = this.addInfoLine(doc, info.ratingLabel || t(lang, 'pdf.geo.rating'), `${info.rating}/5 (${info.reviews} ${t(lang, 'pdf.geo.reviews')})`, y);
      y += 5;
    }

    // Competitors Table
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 100);
      y = this.addSection(doc, audit.competitorsLabel || t(lang, 'pdf.geo.nearbyCompetitors'), y);
      y = this.addGeoCompetitorTable(doc, audit.competitors, y, lang);
      y += 10;
    }

    // NAP Issues
    if (audit.napIssues) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, audit.napIssuesLabel || t(lang, 'pdf.geo.napConsistency'), y);
      const nap = audit.napIssues;
      const yesText = t(lang, 'common.yes');
      const noText = t(lang, 'common.no');
      y = this.addLine(doc, `${nap.nameConsistencyLabel || t(lang, 'pdf.geo.nameConsistency')}: ${nap.nameConsistency ? yesText : noText}`, y);
      y = this.addLine(doc, `${nap.addressConsistencyLabel || t(lang, 'pdf.geo.addressConsistency')}: ${nap.addressConsistency ? yesText : noText}`, y);
      y = this.addLine(doc, `${nap.phoneConsistencyLabel || t(lang, 'pdf.geo.phoneConsistency')}: ${nap.phoneConsistency ? yesText : noText}`, y);
      if (nap.issues && nap.issues.length > 0) {
        y += 3;
        doc.setFontSize(9);
        doc.setTextColor(220, 53, 69);
        nap.issues.forEach(issue => {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(`- ${issue}`, 25, y);
          y += 6;
        });
        doc.setTextColor(0);
      }
      y += 5;
    }

    // Citation Issues
    if (audit.citationIssues) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, audit.citationIssuesLabel || t(lang, 'pdf.geo.citationAnalysis'), y);
      const citations = audit.citationIssues;
      if (citations.missingCitations && citations.missingCitations.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${citations.missingCitationsLabel || t(lang, 'pdf.geo.missingCitations')}:`, 25, y);
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(220, 53, 69);
        citations.missingCitations.forEach(item => {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(`- ${item}`, 30, y);
          y += 6;
        });
        doc.setTextColor(0);
        y += 3;
      }
      if (citations.inconsistentData && citations.inconsistentData.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${citations.inconsistentDataLabel || t(lang, 'pdf.geo.inconsistentData')}:`, 25, y);
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(255, 193, 7);
        citations.inconsistentData.forEach(item => {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(`- ${item}`, 30, y);
          y += 6;
        });
        doc.setTextColor(0);
      }
      y += 5;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, t(lang, 'pdf.geo.recommendations'), y);

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
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }

  // Helper methods
  addSection(doc, title, y) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 20, y);
    doc.setLineWidth(0.5);
    doc.line(20, y + 2, 190, y + 2);
    return y + 12;
  }

  addCheck(doc, label, data, y, lang = 'en') {
    y = this.checkPageBreak(doc, y, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 25, y);
    doc.setFont('helvetica', 'normal');

    const yesText = t(lang, 'common.yes');
    const noText = t(lang, 'common.no');

    if (data.exists !== undefined) {
      const status = data.exists ? yesText : noText;
      doc.setTextColor(data.exists ? 40 : 220, data.exists ? 167 : 53, data.exists ? 69 : 69);
      doc.text(status, 80, y);
      doc.setTextColor(0);
    }

    if (data.value) {
      const truncated = data.value.length > 50 ? data.value.substring(0, 50) + '...' : data.value;
      doc.text(truncated, 100, y);
    }

    if (data.count !== undefined) {
      doc.text(`${data.countLabel || t(lang, 'pdf.seo.count')}: ${data.count}`, 100, y);
    }

    if (data.total !== undefined) {
      doc.text(`${data.totalLabel || t(lang, 'pdf.seo.total')}: ${data.total}, ${data.withoutAltLabel || t(lang, 'pdf.seo.withoutAlt')}: ${data.withoutAlt || 0}`, 100, y);
    }

    if (data.internal !== undefined) {
      doc.text(`${data.internalLabel || t(lang, 'pdf.seo.internal')}: ${data.internal}, ${data.externalLabel || t(lang, 'pdf.seo.external')}: ${data.external}, ${data.brokenLabel || t(lang, 'pdf.seo.broken')}: ${data.broken}`, 100, y);
    }

    return y + 8;
  }

  addKeywordCheck(doc, label, value, y, lang = 'en') {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${label}:`, 25, y);
    const yesText = t(lang, 'common.yes');
    const noText = t(lang, 'common.no');
    doc.setTextColor(value ? 40 : 220, value ? 167 : 53, value ? 69 : 69);
    doc.text(value ? yesText : noText, 80, y);
    doc.setTextColor(0);
    return y + 7;
  }

  addLine(doc, text, y) {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.text(text, 25, y);
    return y + 7;
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

  addFooter(doc, lang = 'en') {
    const pageCount = doc.internal.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`${t(lang, 'pdf.seo.page')} ${i} ${t(lang, 'pdf.seo.of')} ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      doc.text('serpixa.ai', pageWidth - 20, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
    }
  }

  addCompetitorTable(doc, competitors, y, lang = 'en') {
    const pageWidth = doc.internal.pageSize.getWidth();
    const startX = 20;
    const colWidths = [15, 50, 60, 65];
    let currentY = y;

    doc.setFillColor(240, 240, 240);
    doc.rect(startX, currentY, pageWidth - 40, 10, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.seo.pos'), startX + 2, currentY + 7);
    doc.text(t(lang, 'pdf.seo.titleCol'), startX + colWidths[0] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.seo.urlCol'), startX + colWidths[0] + colWidths[1] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.seo.domain'), startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY + 7);
    currentY += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const topCompetitors = competitors.slice(0, 10);

    for (const competitor of topCompetitors) {
      currentY = this.checkPageBreak(doc, currentY, 15);

      doc.setFont('helvetica', 'bold');
      doc.text(`${competitor.position}`, startX + 2, currentY);

      doc.setFont('helvetica', 'normal');
      const title = competitor.title.length > 40 ? competitor.title.substring(0, 37) + '...' : competitor.title;
      doc.text(title, startX + colWidths[0] + 2, currentY, { maxWidth: colWidths[1] - 4 });

      const url = competitor.url.length > 45 ? competitor.url.substring(0, 42) + '...' : competitor.url;
      doc.text(url, startX + colWidths[0] + colWidths[1] + 2, currentY, { maxWidth: colWidths[2] - 4 });

      doc.text(competitor.domain || '', startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY, { maxWidth: colWidths[3] - 4 });

      currentY += 10;
    }

    return currentY;
  }

  addGBPChecklist(doc, checklist, y) {
    for (const item of checklist) {
      y = this.checkPageBreak(doc, y, 10);

      doc.setDrawColor(150);
      doc.rect(25, y - 4, 4, 4);
      if (item.completed) {
        doc.setFillColor(40, 167, 69);
        doc.rect(25.5, y - 3.5, 3, 3, 'F');
      }

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(item.completed ? 0 : 100);
      doc.text(item.label, 32, y);

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

  addGeoCompetitorTable(doc, competitors, y, lang = 'en') {
    const pageWidth = doc.internal.pageSize.getWidth();
    const startX = 20;
    const colWidths = [15, 50, 20, 20, 25, 60];
    let currentY = y;

    const naText = t(lang, 'common.notAvailable');

    doc.setFillColor(240, 240, 240);
    doc.rect(startX, currentY, pageWidth - 40, 10, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.geo.pos'), startX + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.name'), startX + colWidths[0] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.rating'), startX + colWidths[0] + colWidths[1] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.reviewsCol'), startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.dist'), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.address'), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 2, currentY + 7);
    currentY += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const topCompetitors = competitors.slice(0, 10);

    for (const competitor of topCompetitors) {
      currentY = this.checkPageBreak(doc, currentY, 15);

      doc.setFont('helvetica', 'bold');
      doc.text(`${competitor.position}`, startX + 2, currentY);

      doc.setFont('helvetica', 'normal');
      const name = competitor.name.length > 35 ? competitor.name.substring(0, 32) + '...' : competitor.name;
      doc.text(name, startX + colWidths[0] + 2, currentY, { maxWidth: colWidths[1] - 4 });

      doc.text(competitor.rating ? competitor.rating.toFixed(1) : naText, startX + colWidths[0] + colWidths[1] + 2, currentY);

      doc.text(competitor.reviews ? competitor.reviews.toString() : '0', startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY);

      doc.text(competitor.distance || naText, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 2, currentY, { maxWidth: colWidths[4] - 4 });

      const address = competitor.address ? (competitor.address.length > 40 ? competitor.address.substring(0, 37) + '...' : competitor.address) : naText;
      doc.text(address, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 2, currentY, { maxWidth: colWidths[5] - 4 });

      currentY += 10;
    }

    return currentY;
  }
}

export const pdfService = new PDFService();
