import { jsPDF } from 'jspdf';
import { t } from '../locales/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';

class PDFService {
  getLanguageFromAudit(audit) {
    const locale = audit.locale || DEFAULT_LOCALE;
    const localeConfig = getLocaleConfig(locale);
    return localeConfig.language || 'en';
  }

  /**
   * Formats a date in European format (DD/MM/YYYY)
   * @param {Date|string|number} date - Date to format
   * @returns {string} Formatted date string in DD/MM/YYYY format
   */
  formatEuropeanDate(date) {
    if (!date) return "N/A";
    
    const dateObj = date instanceof Date ? date : new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return "N/A";
    }

    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();

    return `${day}/${month}/${year}`;
  }

  generateSEOAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const maxWidth = pageWidth - (margin * 2);
    let y = 0;

    // ===== HEADER WITH PRIMARY BLUE BACKGROUND =====
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(t(lang, 'pdf.seo.title'), pageWidth / 2, 25, { align: 'center' });
    
    // Branding
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 220, 255);
    doc.text(t(lang, 'pdf.seo.poweredBy'), pageWidth / 2, 38, { align: 'center' });
    
    y = 60;

    // ===== AUDIT INFO BOX (Two Column Layout) =====
    const lineHeight = 7;
    const labelCol = margin + 8;
    const valueCol = margin + 55;
    const rowCount = audit.keyword ? 4 : 3;
    const infoBoxHeight = (rowCount * lineHeight) + 16;
    
    // Light background, no border
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, maxWidth, infoBoxHeight, 'F');
    
    doc.setFontSize(9);
    let infoY = y + 12;
    
    // Row 1: URL
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.seo.url'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    const urlText = audit.url.length > 80 ? audit.url.substring(0, 77) + '...' : audit.url;
    doc.text(urlText, valueCol, infoY);
    infoY += lineHeight;
    
    // Row 2: Keyword (if exists)
    if (audit.keyword) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(80, 80, 80);
      doc.text(t(lang, 'pdf.seo.targetKeyword'), labelCol, infoY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      doc.text(audit.keyword, valueCol, infoY);
      infoY += lineHeight;
    }
    
    // Row 3: Date
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.seo.date'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(this.formatEuropeanDate(audit.createdAt), valueCol, infoY);
    infoY += lineHeight;
    
    // Row 4: Generated For
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.seo.generatedFor'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    const userName = user.name || user.email;
    doc.text(userName, valueCol, infoY);
    
    y += infoBoxHeight + 10;

    // ===== SEO SCORE SECTION =====
    const scoreHeight = 40;
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, maxWidth, scoreHeight, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, maxWidth, scoreHeight, 'S');
    
    // Left side - Label
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(t(lang, 'pdf.seo.score'), margin + 15, y + 18);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(t(lang, 'pdf.seo.overallPerformance') || 'Overall SEO Performance', margin + 15, y + 28);
    
    // Right side - Score
    const scoreColor = this.getScoreColor(audit.score);
    const scoreX = pageWidth - margin - 50;
    
    doc.setFontSize(32);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...scoreColor);
    doc.text(`${audit.score}`, scoreX, y + 22, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('/100', scoreX + 20, y + 22);
    
    // Score indicator bar
    const barY = y + 32;
    const barWidth = 60;
    const barHeight = 4;
    const barX = scoreX - 30;
    
    // Background bar
    doc.setFillColor(230, 230, 230);
    doc.rect(barX, barY, barWidth, barHeight, 'F');
    
    // Score bar
    doc.setFillColor(...scoreColor);
    doc.rect(barX, barY, (barWidth * audit.score) / 100, barHeight, 'F');
    
    doc.setTextColor(0);
    y += scoreHeight + 15;

    // ===== ON-PAGE CHECKS SECTION =====
    y = this.addSectionHeader(doc, t(lang, 'pdf.seo.onPageAnalysis'), y, margin, maxWidth);
    
    // Checks in a styled card
    const checks = [
      { label: audit.checks.title?.label || t(lang, 'seo.checks.title'), data: audit.checks.title },
      { label: audit.checks.description?.label || t(lang, 'seo.checks.description'), data: audit.checks.description },
      { label: audit.checks.h1?.label || t(lang, 'seo.checks.h1'), data: audit.checks.h1 },
      { label: audit.checks.canonical?.label || t(lang, 'seo.checks.canonical'), data: audit.checks.canonical },
      { label: audit.checks.images?.label || t(lang, 'seo.checks.images'), data: audit.checks.images },
      { label: audit.checks.links?.label || t(lang, 'seo.checks.links'), data: audit.checks.links },
    ];
    
    for (const check of checks) {
      y = this.checkPageBreak(doc, y, 18);
      y = this.addStyledCheck(doc, check.label, check.data, y, margin, maxWidth, lang);
    }
    y += 10;

    // ===== KEYWORD ANALYSIS SECTION =====
    if (audit.keywordAnalysis) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSectionHeader(doc, audit.keywordAnalysis.title || t(lang, 'pdf.seo.keywordAnalysis'), y, margin, maxWidth);
      
      const kw = audit.keywordAnalysis;
      
      // Keyword checks in grid layout
      const kwChecks = [
        { label: kw.inTitleLabel || t(lang, 'seo.keywordAnalysis.inTitle'), value: kw.inTitle },
        { label: kw.inDescriptionLabel || t(lang, 'seo.keywordAnalysis.inDescription'), value: kw.inDescription },
        { label: kw.inH1Label || t(lang, 'seo.keywordAnalysis.inH1'), value: kw.inH1 },
        { label: kw.inContentLabel || t(lang, 'seo.keywordAnalysis.inContent'), value: kw.inContent },
      ];
      
      // Draw 2x2 grid for keyword checks
      const gridWidth = (maxWidth - 10) / 2;
      const gridHeight = 22;
      
      for (let i = 0; i < kwChecks.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = margin + (col * (gridWidth + 10));
        const gridY = y + (row * (gridHeight + 5));
        
        if (row > 0 || i === 0) {
          this.checkPageBreak(doc, gridY, gridHeight);
        }
        
        // Card background
        doc.setFillColor(252, 252, 252);
        doc.rect(x, gridY, gridWidth, gridHeight, 'F');
        doc.setDrawColor(235, 235, 235);
        doc.setLineWidth(0.3);
        doc.rect(x, gridY, gridWidth, gridHeight, 'S');
        
        // Check icon
        const iconX = x + 8;
        const iconY = gridY + 11;
        if (kwChecks[i].value) {
          doc.setFillColor(40, 167, 69);
          doc.circle(iconX, iconY, 4, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.text('✓', iconX - 2, iconY + 2.5);
        } else {
          doc.setFillColor(220, 53, 69);
          doc.circle(iconX, iconY, 4, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.text('✗', iconX - 2, iconY + 2.5);
        }
        
        // Label
        doc.setTextColor(50, 50, 50);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(kwChecks[i].label, x + 18, gridY + 13);
      }
      
      y += (Math.ceil(kwChecks.length / 2) * (gridHeight + 5)) + 10;
      
      // Density and Occurrences in styled boxes
      y = this.checkPageBreak(doc, y, 25);
      
      const statWidth = (maxWidth - 10) / 2;
      
      // Density box
      doc.setFillColor(248, 249, 250);
      doc.rect(margin, y, statWidth, 20, 'F');
      doc.setDrawColor(220, 220, 220);
      doc.rect(margin, y, statWidth, 20, 'S');
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(kw.densityLabel || t(lang, 'pdf.seo.keywordDensity'), margin + 8, y + 8);
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      doc.text(`${kw.density}%`, margin + 8, y + 16);
      
      // Occurrences box
      doc.setFillColor(248, 249, 250);
      doc.rect(margin + statWidth + 10, y, statWidth, 20, 'F');
      doc.setDrawColor(220, 220, 220);
      doc.rect(margin + statWidth + 10, y, statWidth, 20, 'S');
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(kw.occurrencesLabel || t(lang, 'pdf.seo.occurrences'), margin + statWidth + 18, y + 8);
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      doc.text(`${kw.occurrences}`, margin + statWidth + 18, y + 16);
      
      y += 30;
    }

    // ===== COMPETITOR RANKING TABLE =====
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 100);
      y = this.addSectionHeader(doc, t(lang, 'pdf.seo.competitorRankings'), y, margin, maxWidth);
      y = this.addStyledCompetitorTable(doc, audit.competitors, y, margin, maxWidth, lang);
      y += 15;
    }

    // ===== RECOMMENDATIONS SECTION =====
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSectionHeader(doc, t(lang, 'pdf.seo.recommendations'), y, margin, maxWidth);

      for (let i = 0; i < audit.recommendations.length; i++) {
        const rec = audit.recommendations[i];
        y = this.checkPageBreak(doc, y, 35);
        
        // Priority badge colors
        const priorityColors = {
          critical: { bg: [254, 226, 226], text: [153, 27, 27], label: 'Critical' },
          high: { bg: [254, 243, 199], text: [146, 64, 14], label: 'High' },
          medium: { bg: [254, 249, 195], text: [133, 77, 14], label: 'Medium' },
          low: { bg: [220, 252, 231], text: [22, 101, 52], label: 'Low' }
        };
        const priority = priorityColors[rec.priority] || priorityColors.medium;
        
        // Calculate text wrapping first to determine card height
        const badgeWidth = 28;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        const issueLines = doc.splitTextToSize(rec.issue, maxWidth - badgeWidth - 20);
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        const actionLines = doc.splitTextToSize(rec.action, maxWidth - 25);
        
        // Calculate card height based on both issue and action text
        const issueHeight = issueLines.length * 5; // ~5pt per line for font size 10
        const actionHeight = Math.min(actionLines.length, 2) * 5; // Max 2 lines for action
        const cardHeight = Math.max(28, 12 + issueHeight + actionHeight + 8); // 12 for top padding, 8 for bottom
        
        doc.setFillColor(255, 255, 255);
        doc.rect(margin, y, maxWidth, cardHeight, 'F');
        doc.setDrawColor(235, 235, 235);
        doc.setLineWidth(0.3);
        doc.rect(margin, y, maxWidth, cardHeight, 'S');
        
        // Left border accent (thin)
        doc.setFillColor(...(rec.priority === 'critical' ? [220, 38, 38] : rec.priority === 'high' ? [245, 158, 11] : rec.priority === 'medium' ? [234, 179, 8] : [34, 197, 94]));
        doc.rect(margin, y, 1.5, cardHeight, 'F');
        
        // Priority badge (compact)
        doc.setFillColor(...priority.bg);
        doc.rect(margin + maxWidth - badgeWidth - 5, y + 5, badgeWidth, 9, 'F');
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...priority.text);
        doc.text(priority.label.toUpperCase(), margin + maxWidth - badgeWidth / 2 - 5, y + 11, { align: 'center' });
        
        // Issue title (no truncation - use text wrapping)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        let issueY = y + 12;
        doc.text(issueLines, margin + 10, issueY);
        
        // Action text (positioned after issue title)
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        const actionY = issueY + (issueLines.length * 5) + 3;
        doc.text(actionLines.slice(0, 2), margin + 10, actionY);
        
        y += cardHeight + 8;
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
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const maxWidth = pageWidth - (margin * 2);
    let y = 0;

    // ===== HEADER WITH PRIMARY BLUE BACKGROUND =====
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(t(lang, 'pdf.gbp.title'), pageWidth / 2, 25, { align: 'center' });
    
    // Branding
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 220, 255);
    doc.text(t(lang, 'pdf.gbp.poweredBy'), pageWidth / 2, 38, { align: 'center' });
    
    y = 60;

    // ===== AUDIT INFO BOX (Two Column Layout) =====
    const lineHeight = 7;
    const labelCol = margin + 8;
    const valueCol = margin + 55;
    const infoBoxHeight = 30;
    
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, maxWidth, infoBoxHeight, 'F');
    
    doc.setFontSize(9);
    let infoY = y + 10;
    
    // Row 1: Business Name
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.gbp.business'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(audit.businessName || '', valueCol, infoY);
    infoY += lineHeight;
    
    // Row 2: Date
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.gbp.date'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(this.formatEuropeanDate(audit.createdAt), valueCol, infoY);
    infoY += lineHeight;
    
    // Row 3: Generated For
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.gbp.generatedFor'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(user.name || user.email, valueCol, infoY);
    
    y += infoBoxHeight + 10;

    // ===== COMPLETENESS SCORE SECTION =====
    const scoreHeight = 40;
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, maxWidth, scoreHeight, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, maxWidth, scoreHeight, 'S');
    
    // Left side - Label
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(audit.scoreLabel || t(lang, 'pdf.gbp.completenessScore'), margin + 15, y + 18);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(t(lang, 'pdf.gbp.profileCompleteness') || 'Profile Completeness', margin + 15, y + 28);
    
    // Right side - Score
    const scoreColor = this.getScoreColor(audit.score);
    const scoreX = pageWidth - margin - 50;
    
    doc.setFontSize(32);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...scoreColor);
    doc.text(`${audit.score}`, scoreX, y + 22, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('%', scoreX + 18, y + 22);
    
    // Score indicator bar
    const barY = y + 32;
    const barWidth = 60;
    const barHeight = 4;
    const barX = scoreX - 30;
    
    doc.setFillColor(230, 230, 230);
    doc.rect(barX, barY, barWidth, barHeight, 'F');
    doc.setFillColor(...scoreColor);
    doc.rect(barX, barY, (barWidth * audit.score) / 100, barHeight, 'F');
    
    doc.setTextColor(0);
    y += scoreHeight + 15;

    // ===== BUSINESS INFORMATION SECTION =====
    if (audit.businessInfo) {
      const info = audit.businessInfo;
      const businessFields = [
        { label: info.nameLabel || t(lang, 'pdf.gbp.name'), value: info.name },
        { label: info.addressLabel || t(lang, 'pdf.gbp.address'), value: info.address },
        { label: info.phoneLabel || t(lang, 'pdf.gbp.phone'), value: info.phone },
        { label: info.websiteLabel || t(lang, 'pdf.gbp.website'), value: info.website },
        { label: info.categoryLabel || t(lang, 'pdf.gbp.category'), value: info.category },
        { label: info.ratingLabel || t(lang, 'pdf.gbp.rating'), value: info.rating ? `${info.rating}/5 (${info.reviewCount} ${t(lang, 'pdf.gbp.reviews')})` : null },
      ].filter(f => f.value);
      
      // Only show section if there's data to display
      if (businessFields.length > 0) {
        y = this.addSectionHeader(doc, audit.businessInfoLabel || t(lang, 'pdf.gbp.businessInfo'), y, margin, maxWidth);
        
        for (const field of businessFields) {
          y = this.checkPageBreak(doc, y, 12);
          y = this.addStyledInfoRow(doc, field.label, field.value, y, margin, maxWidth);
        }
        y += 10;
      }
    }

    // ===== PROFILE CHECKLIST SECTION =====
    if (audit.checklist?.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSectionHeader(doc, audit.checklistLabel || t(lang, 'pdf.gbp.profileChecklist'), y, margin, maxWidth);
      y = this.addStyledGBPChecklist(doc, audit.checklist, y, margin, maxWidth);
      y += 10;
    }

    // ===== RECOMMENDATIONS SECTION =====
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSectionHeader(doc, t(lang, 'pdf.gbp.recommendations'), y, margin, maxWidth);

      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 35);
        y = this.addStyledRecommendation(doc, rec, y, margin, maxWidth);
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
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const maxWidth = pageWidth - (margin * 2);
    let y = 0;

    // ===== HEADER WITH PRIMARY BLUE BACKGROUND =====
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(t(lang, 'pdf.geo.title'), pageWidth / 2, 25, { align: 'center' });
    
    // Branding
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 220, 255);
    doc.text(t(lang, 'pdf.geo.poweredBy'), pageWidth / 2, 38, { align: 'center' });
    
    y = 60;

    // ===== AUDIT INFO BOX (Two Column Layout) =====
    const lineHeight = 7;
    const labelCol = margin + 8;
    const valueCol = margin + 55;
    const infoBoxHeight = 44;
    
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, maxWidth, infoBoxHeight, 'F');
    
    doc.setFontSize(9);
    let infoY = y + 10;
    
    // Row 1: Business Name
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.geo.business'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(audit.businessName || '', valueCol, infoY);
    infoY += lineHeight;
    
    // Row 2: Keyword
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.geo.keyword'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(audit.keyword || '', valueCol, infoY);
    infoY += lineHeight;
    
    // Row 3: Location
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.geo.location'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(audit.location || '', valueCol, infoY);
    infoY += lineHeight;
    
    // Row 4: Date
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.geo.date'), labelCol, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(this.formatEuropeanDate(audit.createdAt), valueCol, infoY);
    
    // Generated For on same line
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(t(lang, 'pdf.geo.generatedFor'), labelCol + 80, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(user.name || user.email, valueCol + 80, infoY);
    
    y += infoBoxHeight + 10;

    // ===== LOCAL VISIBILITY SCORE SECTION =====
    const scoreHeight = 40;
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, maxWidth, scoreHeight, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, maxWidth, scoreHeight, 'S');
    
    // Left side - Label
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(audit.localVisibilityScoreLabel || t(lang, 'pdf.geo.localVisibilityScore'), margin + 15, y + 18);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(t(lang, 'pdf.geo.localSearchPerformance') || 'Local Search Performance', margin + 15, y + 28);
    
    // Right side - Score
    const scoreColor = this.getScoreColor(audit.localVisibilityScore);
    const scoreX = pageWidth - margin - 50;
    
    doc.setFontSize(32);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...scoreColor);
    doc.text(`${audit.localVisibilityScore}`, scoreX, y + 22, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('/100', scoreX + 20, y + 22);
    
    // Score indicator bar
    const barY = y + 32;
    const barWidth = 60;
    const barHeight = 4;
    const barX = scoreX - 30;
    
    doc.setFillColor(230, 230, 230);
    doc.rect(barX, barY, barWidth, barHeight, 'F');
    doc.setFillColor(...scoreColor);
    doc.rect(barX, barY, (barWidth * audit.localVisibilityScore) / 100, barHeight, 'F');
    
    doc.setTextColor(0);
    y += scoreHeight + 15;

    // ===== BUSINESS INFORMATION SECTION =====
    if (audit.businessInfo) {
      const info = audit.businessInfo;
      const businessFields = [
        { label: info.nameLabel || t(lang, 'pdf.geo.name'), value: info.name },
        { label: info.addressLabel || t(lang, 'pdf.geo.address'), value: info.address },
        { label: info.phoneLabel || t(lang, 'pdf.geo.phone'), value: info.phone },
        { label: info.websiteLabel || t(lang, 'pdf.geo.website'), value: info.website },
        { label: info.categoryLabel || t(lang, 'pdf.geo.category'), value: info.category },
        { label: info.ratingLabel || t(lang, 'pdf.geo.rating'), value: info.rating ? `${info.rating}/5 (${info.reviews} ${t(lang, 'pdf.geo.reviews')})` : null },
      ].filter(f => f.value);
      
      // Only show section if there's data to display
      if (businessFields.length > 0) {
        y = this.addSectionHeader(doc, audit.businessInfoLabel || t(lang, 'pdf.geo.businessInfo'), y, margin, maxWidth);
        
        for (const field of businessFields) {
          y = this.checkPageBreak(doc, y, 12);
          y = this.addStyledInfoRow(doc, field.label, field.value, y, margin, maxWidth);
        }
        y += 10;
      }
    }

    // ===== COMPETITORS TABLE =====
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 100);
      y = this.addSectionHeader(doc, audit.competitorsLabel || t(lang, 'pdf.geo.nearbyCompetitors'), y, margin, maxWidth);
      y = this.addStyledGeoCompetitorTable(doc, audit.competitors, y, margin, maxWidth, lang);
      y += 15;
    }

    // ===== NAP CONSISTENCY SECTION =====
    if (audit.napIssues) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSectionHeader(doc, audit.napIssuesLabel || t(lang, 'pdf.geo.napConsistency'), y, margin, maxWidth);
      
      const nap = audit.napIssues;
      const napChecks = [
        { label: nap.nameConsistencyLabel || t(lang, 'pdf.geo.nameConsistency'), value: nap.nameConsistency },
        { label: nap.addressConsistencyLabel || t(lang, 'pdf.geo.addressConsistency'), value: nap.addressConsistency },
        { label: nap.phoneConsistencyLabel || t(lang, 'pdf.geo.phoneConsistency'), value: nap.phoneConsistency },
      ];
      
      // NAP checks in grid (compact)
      const gridWidth = (maxWidth - 10) / 3;
      const gridHeight = 16;
      
      for (let i = 0; i < napChecks.length; i++) {
        const x = margin + (i * (gridWidth + 5));
        
        doc.setFillColor(252, 252, 252);
        doc.rect(x, y, gridWidth, gridHeight, 'F');
        doc.setDrawColor(235, 235, 235);
        doc.setLineWidth(0.3);
        doc.rect(x, y, gridWidth, gridHeight, 'S');
        
        // Small bullet point
        const bulletX = x + 6;
        const bulletY = y + 8;
        if (napChecks[i].value) {
          doc.setFillColor(40, 167, 69);
        } else {
          doc.setFillColor(220, 53, 69);
        }
        doc.circle(bulletX, bulletY, 2, 'F');
        
        // Label (full text)
        doc.setTextColor(50, 50, 50);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(napChecks[i].label, x + 12, y + 10);
      }
      
      y += gridHeight + 8;
      
      // NAP Issues list
      if (nap.issues && nap.issues.length > 0) {
        doc.setFillColor(254, 243, 199);
        const issuesHeight = 10 + (nap.issues.length * 6);
        doc.rect(margin, y, maxWidth, issuesHeight, 'F');
        
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(146, 64, 14);
        doc.text('Issues Found:', margin + 5, y + 8);
        
        doc.setFont('helvetica', 'normal');
        let issueY = y + 15;
        nap.issues.forEach(issue => {
          doc.text(`• ${issue}`, margin + 8, issueY);
          issueY += 6;
        });
        
        y += issuesHeight + 5;
      }
      y += 10;
    }

    // ===== CITATION ANALYSIS SECTION =====
    if (audit.citationIssues) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSectionHeader(doc, audit.citationIssuesLabel || t(lang, 'pdf.geo.citationAnalysis'), y, margin, maxWidth);
      
      const citations = audit.citationIssues;
      
      // Missing Citations
      if (citations.missingCitations && citations.missingCitations.length > 0) {
        const missingHeight = 12 + (citations.missingCitations.length * 6);
        doc.setFillColor(254, 226, 226);
        doc.rect(margin, y, maxWidth, missingHeight, 'F');
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(153, 27, 27);
        doc.text(citations.missingCitationsLabel || t(lang, 'pdf.geo.missingCitations'), margin + 5, y + 9);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        let itemY = y + 17;
        citations.missingCitations.forEach(item => {
          doc.text(`• ${item}`, margin + 8, itemY);
          itemY += 6;
        });
        
        y += missingHeight + 8;
      }
      
      // Inconsistent Data
      if (citations.inconsistentData && citations.inconsistentData.length > 0) {
        y = this.checkPageBreak(doc, y, 30);
        const inconsistentHeight = 12 + (citations.inconsistentData.length * 6);
        doc.setFillColor(254, 249, 195);
        doc.rect(margin, y, maxWidth, inconsistentHeight, 'F');
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(133, 77, 14);
        doc.text(citations.inconsistentDataLabel || t(lang, 'pdf.geo.inconsistentData'), margin + 5, y + 9);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        let itemY = y + 17;
        citations.inconsistentData.forEach(item => {
          doc.text(`• ${item}`, margin + 8, itemY);
          itemY += 6;
        });
        
        y += inconsistentHeight + 8;
      }
      y += 5;
    }

    // ===== RECOMMENDATIONS SECTION =====
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSectionHeader(doc, t(lang, 'pdf.geo.recommendations'), y, margin, maxWidth);

      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 35);
        y = this.addStyledRecommendation(doc, rec, y, margin, maxWidth);
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

  /**
   * Add a styled section header with underline
   */
  addSectionHeader(doc, title, y, margin, maxWidth) {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text(title, margin, y);
    
    // Underline
    doc.setDrawColor(40, 40, 40);
    doc.setLineWidth(0.8);
    doc.line(margin, y + 3, margin + 40, y + 3);
    
    doc.setTextColor(0);
    return y + 15;
  }

  /**
   * Add a styled check item for SEO audit
   */
  addStyledCheck(doc, label, data, y, margin, maxWidth, lang = 'en') {
    // Calculate content height based on value length
    let valueLines = [];
    let detailText = '';
    
    if (data?.value) {
      detailText = data.value;
    } else if (data?.count !== undefined) {
      detailText = `${data.countLabel || t(lang, 'pdf.seo.count')}: ${data.count}`;
    } else if (data?.total !== undefined) {
      detailText = `Total: ${data.total}, No Alt: ${data.withoutAlt || 0}`;
    } else if (data?.internal !== undefined) {
      detailText = `Internal: ${data.internal}, External: ${data.external}, Broken: ${data.broken}`;
    }
    
    // Calculate lines needed for value text
    doc.setFontSize(8);
    const valueStartX = margin + 75;
    if (detailText) {
      valueLines = doc.splitTextToSize(detailText, maxWidth - 80);
    }
    
    const lineHeight = 5;
    const minRowHeight = 14;
    const contentHeight = Math.max(minRowHeight, 8 + (valueLines.length * lineHeight));
    
    // Row background
    doc.setFillColor(252, 252, 253);
    doc.rect(margin, y, maxWidth, contentHeight, 'F');
    
    // Bottom border
    doc.setDrawColor(235, 235, 235);
    doc.setLineWidth(0.3);
    doc.line(margin, y + contentHeight, margin + maxWidth, y + contentHeight);
    
    // Label
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(label, margin + 5, y + 9);
    
    // Value/Details (full text, paragraph style)
    if (valueLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(8);
      
      let detailY = y + 9;
      
      for (const line of valueLines) {
        doc.text(line, valueStartX, detailY);
        detailY += lineHeight;
      }
    }
    
    doc.setTextColor(0);
    return y + contentHeight + 1;
  }

  /**
   * Add a styled competitor table
   */
  addStyledCompetitorTable(doc, competitors, y, margin, maxWidth, lang = 'en') {
    const colWidths = [18, 55, 70, 43];
    const rowHeight = 12;
    
    // Table header
    doc.setFillColor(40, 40, 40);
    doc.rect(margin, y, maxWidth, rowHeight, 'F');
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    
    let xPos = margin + 5;
    doc.text(t(lang, 'pdf.seo.pos'), xPos, y + 8);
    xPos += colWidths[0];
    doc.text(t(lang, 'pdf.seo.titleCol'), xPos, y + 8);
    xPos += colWidths[1];
    doc.text(t(lang, 'pdf.seo.urlCol'), xPos, y + 8);
    xPos += colWidths[2];
    doc.text(t(lang, 'pdf.seo.domain'), xPos, y + 8);
    
    y += rowHeight;
    
    // Table rows
    const topCompetitors = competitors.slice(0, 10);
    
    for (let i = 0; i < topCompetitors.length; i++) {
      const competitor = topCompetitors[i];
      y = this.checkPageBreak(doc, y, rowHeight + 5);
      
      // Alternating row colors
      if (i % 2 === 0) {
        doc.setFillColor(250, 250, 250);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(margin, y, maxWidth, rowHeight, 'F');
      
      // Row border
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.2);
      doc.line(margin, y + rowHeight, margin + maxWidth, y + rowHeight);
      
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      
      xPos = margin + 5;
      
      // Position with badge style
      doc.setFont('helvetica', 'bold');
      if (competitor.position <= 3) {
        const badgeColors = { 1: [255, 215, 0], 2: [192, 192, 192], 3: [205, 127, 50] };
        doc.setFillColor(...(badgeColors[competitor.position] || [200, 200, 200]));
        doc.circle(xPos + 4, y + 6, 4, 'F');
        doc.setTextColor(40, 40, 40);
        doc.text(`${competitor.position}`, xPos + 4, y + 7.5, { align: 'center' });
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text(`${competitor.position}`, xPos + 4, y + 7.5, { align: 'center' });
      }
      xPos += colWidths[0];
      
      // Title
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      const title = competitor.title.length > 35 ? competitor.title.substring(0, 32) + '...' : competitor.title;
      doc.text(title, xPos, y + 8);
      xPos += colWidths[1];
      
      // URL
      doc.setTextColor(100, 100, 100);
      const url = competitor.url.length > 45 ? competitor.url.substring(0, 42) + '...' : competitor.url;
      doc.text(url, xPos, y + 8);
      xPos += colWidths[2];
      
      // Domain (full, no truncation)
      doc.setTextColor(80, 80, 80);
      doc.text(competitor.domain || '', xPos, y + 8);
      
      y += rowHeight;
    }
    
    doc.setTextColor(0);
    return y;
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

  /**
   * Add a styled info row (label + value) - full value, no truncation
   */
  addStyledInfoRow(doc, label, value, y, margin, maxWidth) {
    const valueText = String(value || '');
    doc.setFontSize(9);
    const valueLines = doc.splitTextToSize(valueText, maxWidth - 65);
    const lineHeight = 5;
    const minRowHeight = 12;
    const rowHeight = Math.max(minRowHeight, 8 + (valueLines.length * lineHeight));
    
    doc.setFillColor(252, 252, 253);
    doc.rect(margin, y, maxWidth, rowHeight, 'F');
    
    doc.setDrawColor(240, 240, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, y + rowHeight, margin + maxWidth, y + rowHeight);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(label, margin + 5, y + 8);
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    let valueY = y + 8;
    for (const line of valueLines) {
      doc.text(line, margin + 60, valueY);
      valueY += lineHeight;
    }
    
    return y + rowHeight + 1;
  }

  /**
   * Add styled GBP checklist
   */
  addStyledGBPChecklist(doc, checklist, y, margin, maxWidth) {
    for (const item of checklist) {
      // Calculate value text and lines needed
      const valueStr = item.value ? (typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)) : '';
      doc.setFontSize(9);
      const valueLines = valueStr ? doc.splitTextToSize(valueStr, maxWidth - 105) : [];
      const lineHeight = 5;
      const minRowHeight = 12;
      const rowHeight = Math.max(minRowHeight, 8 + (valueLines.length * lineHeight));
      
      y = this.checkPageBreak(doc, y, rowHeight + 2);
      
      // Row background
      doc.setFillColor(252, 252, 253);
      doc.rect(margin, y, maxWidth, rowHeight, 'F');
      
      // Bottom border
      doc.setDrawColor(240, 240, 240);
      doc.setLineWidth(0.3);
      doc.line(margin, y + rowHeight, margin + maxWidth, y + rowHeight);
      
      // Small bullet point
      const bulletX = margin + 6;
      const bulletY = y + 7;
      
      if (item.completed) {
        doc.setFillColor(40, 167, 69);
      } else {
        doc.setFillColor(220, 53, 69);
      }
      doc.circle(bulletX, bulletY, 2, 'F');
      
      // Label
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(item.completed ? 40 : 100, item.completed ? 40 : 100, item.completed ? 40 : 100);
      doc.text(item.label, margin + 12, y + 8);
      
      // Value (full text, no truncation)
      if (valueLines.length > 0) {
        doc.setTextColor(80, 80, 80);
        let valueY = y + 8;
        for (const line of valueLines) {
          doc.text(line, margin + 95, valueY);
          valueY += lineHeight;
        }
      }
      
      y += rowHeight + 1;
    }
    
    doc.setTextColor(0);
    return y;
  }

  /**
   * Add styled recommendation card - full text, no truncation
   */
  addStyledRecommendation(doc, rec, y, margin, maxWidth) {
    // Priority badge colors
    const priorityColors = {
      critical: { bg: [254, 226, 226], text: [153, 27, 27], border: [220, 38, 38], label: 'Critical' },
      high: { bg: [254, 243, 199], text: [146, 64, 14], border: [245, 158, 11], label: 'High' },
      medium: { bg: [254, 249, 195], text: [133, 77, 14], border: [234, 179, 8], label: 'Medium' },
      low: { bg: [220, 252, 231], text: [22, 101, 52], border: [34, 197, 94], label: 'Low' }
    };
    const priority = priorityColors[rec.priority] || priorityColors.medium;
    
    // Calculate card height based on full content
    doc.setFontSize(10);
    const issueLines = doc.splitTextToSize(rec.issue, maxWidth - 50);
    doc.setFontSize(9);
    const actionLines = doc.splitTextToSize(rec.action, maxWidth - 20);
    const cardHeight = 14 + (issueLines.length * 5) + (actionLines.length * 5);
    
    // Card background
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, maxWidth, cardHeight, 'F');
    doc.setDrawColor(235, 235, 235);
    doc.setLineWidth(0.3);
    doc.rect(margin, y, maxWidth, cardHeight, 'S');
    
    // Left border accent (thin)
    doc.setFillColor(...priority.border);
    doc.rect(margin, y, 1.5, cardHeight, 'F');
    
    // Priority badge (compact)
    doc.setFillColor(...priority.bg);
    const badgeWidth = 28;
    doc.rect(margin + maxWidth - badgeWidth - 5, y + 5, badgeWidth, 9, 'F');
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...priority.text);
    doc.text(priority.label.toUpperCase(), margin + maxWidth - badgeWidth / 2 - 5, y + 11, { align: 'center' });
    
    // Issue title (full text)
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    let issueY = y + 12;
    for (const line of issueLines) {
      doc.text(line, margin + 8, issueY);
      issueY += 5;
    }
    
    // Action text (full text)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    let actionY = issueY + 3;
    for (const line of actionLines) {
      doc.text(line, margin + 8, actionY);
      actionY += 5;
    }
    
    doc.setTextColor(0);
    return y + cardHeight + 6;
  }

  /**
   * Add styled geo competitor table - with fuller values
   */
  addStyledGeoCompetitorTable(doc, competitors, y, margin, maxWidth, lang = 'en') {
    const colWidths = [15, 55, 18, 20, 20, 58];
    const rowHeight = 12;
    const naText = t(lang, 'common.notAvailable');
    
    // Table header
    doc.setFillColor(40, 40, 40);
    doc.rect(margin, y, maxWidth, rowHeight, 'F');
    
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    
    let xPos = margin + 2;
    doc.text('#', xPos + 4, y + 8);
    xPos += colWidths[0];
    doc.text(t(lang, 'pdf.geo.name'), xPos, y + 8);
    xPos += colWidths[1];
    doc.text(t(lang, 'pdf.geo.rating'), xPos, y + 8);
    xPos += colWidths[2];
    doc.text(t(lang, 'pdf.geo.reviewsCol'), xPos, y + 8);
    xPos += colWidths[3];
    doc.text(t(lang, 'pdf.geo.dist'), xPos, y + 8);
    xPos += colWidths[4];
    doc.text(t(lang, 'pdf.geo.address'), xPos, y + 8);
    
    y += rowHeight;
    
    // Table rows
    const topCompetitors = competitors.slice(0, 10);
    
    for (let i = 0; i < topCompetitors.length; i++) {
      const competitor = topCompetitors[i];
      y = this.checkPageBreak(doc, y, rowHeight + 5);
      
      // Alternating row colors
      doc.setFillColor(i % 2 === 0 ? 250 : 255, i % 2 === 0 ? 250 : 255, i % 2 === 0 ? 250 : 255);
      doc.rect(margin, y, maxWidth, rowHeight, 'F');
      
      // Row border
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.2);
      doc.line(margin, y + rowHeight, margin + maxWidth, y + rowHeight);
      
      doc.setFontSize(7);
      xPos = margin + 2;
      
      // Position with small badge for top 3
      doc.setFont('helvetica', 'bold');
      if (competitor.position <= 3) {
        const badgeColors = { 1: [255, 215, 0], 2: [192, 192, 192], 3: [205, 127, 50] };
        doc.setFillColor(...(badgeColors[competitor.position] || [200, 200, 200]));
        doc.circle(xPos + 5, y + 6, 3, 'F');
        doc.setTextColor(40, 40, 40);
        doc.text(`${competitor.position}`, xPos + 5, y + 7, { align: 'center' });
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text(`${competitor.position}`, xPos + 5, y + 8, { align: 'center' });
      }
      xPos += colWidths[0];
      
      // Name (fuller)
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      const name = competitor.name.length > 35 ? competitor.name.substring(0, 32) + '...' : competitor.name;
      doc.text(name, xPos, y + 8);
      xPos += colWidths[1];
      
      // Rating
      doc.setTextColor(80, 80, 80);
      doc.text(competitor.rating ? competitor.rating.toFixed(1) : naText, xPos, y + 8);
      xPos += colWidths[2];
      
      // Reviews
      doc.text(competitor.reviews ? competitor.reviews.toString() : '0', xPos, y + 8);
      xPos += colWidths[3];
      
      // Distance
      doc.text(competitor.distance || naText, xPos, y + 8);
      xPos += colWidths[4];
      
      // Address (fuller)
      const address = competitor.address ? (competitor.address.length > 40 ? competitor.address.substring(0, 37) + '...' : competitor.address) : naText;
      doc.text(address, xPos, y + 8);
      
      y += rowHeight;
    }
    
    doc.setTextColor(0);
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

  /**
   * Strip HTML tags and extract text content
   */
  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  /**
   * Parse HTML content into structured elements for PDF rendering
   * Excludes FAQ sections to avoid duplication
   */
  parseHtmlForPDF(html) {
    if (!html) return [];
    
    const elements = [];
    // Replace \n with actual newlines first
    let processedHtml = html.replace(/\\n/g, '\n');
    
    // Remove FAQ sections from HTML to avoid duplication
    // First, remove Schema.org FAQPage sections completely
    processedHtml = processedHtml.replace(/<div[^>]*itemscope[^>]*itemtype=["']https?:\/\/schema\.org\/FAQPage["'][^>]*>[\s\S]*?<\/div>/gi, '');
    
    // Remove FAQ headings and all content until next major heading (H1, H2) or conclusion/CTA
    // Look for FAQ heading (case insensitive, can be in various languages)
    const faqKeywords = ['faq', 'frequently asked', 'questions fréquentes', 'veelgestelde vragen', 'questions', 'réponses'];
    const faqHeadingPattern = new RegExp(`<h([1-6])[^>]*>.*?(?:${faqKeywords.join('|')}).*?<\/h[1-6]>`, 'i');
    let faqMatch;
    
    while ((faqMatch = processedHtml.match(faqHeadingPattern)) !== null) {
      const faqStartIndex = faqMatch.index;
      const faqHeadingLevel = parseInt(faqMatch[1]);
      
      // Find content after FAQ heading
      const afterFaqHeading = processedHtml.substring(faqStartIndex + faqMatch[0].length);
      
      // Look for next major section: H1, H2, or conclusion/CTA headings
      const nextSectionPattern = /<h([12])[^>]*>|<h[1-6][^>]*>.*?(?:conclusion|conclu|cta|call to action|appel à l'action).*?<\/h[1-6]>/i;
      const nextSectionMatch = afterFaqHeading.match(nextSectionPattern);
      
      let faqEndIndex;
      if (nextSectionMatch) {
        // Remove FAQ section up to next major section
        faqEndIndex = faqStartIndex + faqMatch[0].length + nextSectionMatch.index;
      } else {
        // If no next section found, look for any heading of same or higher level
        const sameLevelPattern = new RegExp(`<h([1-${faqHeadingLevel}])[^>]*>`, 'i');
        const sameLevelMatch = afterFaqHeading.match(sameLevelPattern);
        
        if (sameLevelMatch) {
          faqEndIndex = faqStartIndex + faqMatch[0].length + sameLevelMatch.index;
        } else {
          // Remove FAQ section to end of content
          faqEndIndex = processedHtml.length;
        }
      }
      
      // Remove the FAQ section
      processedHtml = processedHtml.substring(0, faqStartIndex) + processedHtml.substring(faqEndIndex);
    }
    
    // Extract headings
    const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let lastIndex = 0;
    let match;
    
    while ((match = headingPattern.exec(processedHtml)) !== null) {
      // Skip FAQ-related headings (should already be removed, but double-check)
      const headingText = this.stripHtml(match[2]).toLowerCase();
      const faqKeywords = ['faq', 'frequently asked', 'questions fréquentes', 'veelgestelde vragen'];
      if (faqKeywords.some(keyword => headingText.includes(keyword))) {
        lastIndex = match.index + match[0].length;
        continue;
      }
      
      // Add content before heading
      if (match.index > lastIndex) {
        const beforeContent = processedHtml.substring(lastIndex, match.index);
        const paragraphs = this.extractParagraphs(beforeContent);
        elements.push(...paragraphs);
      }
      
      // Add heading
      const level = parseInt(match[1]);
      const text = this.stripHtml(match[2]);
      if (text.trim()) {
        elements.push({ type: 'heading', level, text: text.trim() });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining content
    if (lastIndex < processedHtml.length) {
      const remainingContent = processedHtml.substring(lastIndex);
      const paragraphs = this.extractParagraphs(remainingContent);
      elements.push(...paragraphs);
    }
    
    return elements;
  }

  /**
   * Extract paragraphs and lists from HTML content
   */
  extractParagraphs(html) {
    const elements = [];
    
    // Remove script and style tags
    let cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Extract lists first
    const listPattern = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
    let listMatch;
    let lastIndex = 0;
    
    while ((listMatch = listPattern.exec(cleanHtml)) !== null) {
      // Add content before list
      if (listMatch.index > lastIndex) {
        const beforeContent = cleanHtml.substring(lastIndex, listMatch.index);
        const paras = this.extractSimpleParagraphs(beforeContent);
        elements.push(...paras);
      }
      
      // Extract list items
      const listType = listMatch[1];
      const listContent = listMatch[2];
      const items = [];
      const itemPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let itemMatch;
      
      while ((itemMatch = itemPattern.exec(listContent)) !== null) {
        const itemText = this.stripHtml(itemMatch[1]).trim();
        if (itemText) {
          items.push(itemText);
        }
      }
      
      if (items.length > 0) {
        elements.push({ type: 'list', ordered: listType === 'ol', items });
      }
      
      lastIndex = listMatch.index + listMatch[0].length;
    }
    
    // Add remaining content as paragraphs
    if (lastIndex < cleanHtml.length) {
      const remainingContent = cleanHtml.substring(lastIndex);
      const paras = this.extractSimpleParagraphs(remainingContent);
      elements.push(...paras);
    }
    
    return elements;
  }

  /**
   * Extract simple paragraphs from HTML
   */
  extractSimpleParagraphs(html) {
    const elements = [];
    
    // Extract paragraph tags
    const paraPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let paraMatch;
    let lastIndex = 0;
    
    while ((paraMatch = paraPattern.exec(html)) !== null) {
      // Add content before paragraph
      if (paraMatch.index > lastIndex) {
        const beforeText = this.stripHtml(html.substring(lastIndex, paraMatch.index)).trim();
        if (beforeText) {
          elements.push({ type: 'paragraph', text: beforeText });
        }
      }
      
      // Add paragraph
      const paraText = this.stripHtml(paraMatch[1]).trim();
      if (paraText) {
        elements.push({ type: 'paragraph', text: paraText });
      }
      
      lastIndex = paraMatch.index + paraMatch[0].length;
    }
    
    // Add remaining content
    if (lastIndex < html.length) {
      const remainingText = this.stripHtml(html.substring(lastIndex)).trim();
      if (remainingText) {
        // Split by double newlines to create paragraphs
        const paragraphs = remainingText.split(/\n\s*\n/).filter(p => p.trim());
        paragraphs.forEach(p => {
          elements.push({ type: 'paragraph', text: p.trim() });
        });
      }
    }
    
    return elements;
  }

  /**
   * Split text into lines that fit within page width
   */
  splitTextIntoLines(doc, text, maxWidth, x) {
    const lines = doc.splitTextToSize(text, maxWidth);
    return lines || [text];
  }

  /**
   * Generate AI Content PDF Report
   */
  generateAIContentReport(content, user) {
    const lang = this.getLanguageFromAudit(content);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - (margin * 2);
    let y = 20;

    // Header with background
    doc.setFillColor(40, 40, 40);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('AI-Generated SEO Content Report', pageWidth / 2, 25, { align: 'center' });
    
    // Branding
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    doc.text('Powered by serpixa.eu', pageWidth / 2, 38, { align: 'center' });
    
    y = 60;

    // Content Info Box
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, pageWidth - (margin * 2), 50, 'F');
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, pageWidth - (margin * 2), 50, 'S');
    
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const infoY = y + 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Topic:', margin + 5, infoY);
    doc.setFont('helvetica', 'normal');
    doc.text(content.topic || 'N/A', margin + 30, infoY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Keyword:', margin + 5, infoY + 8);
    doc.setFont('helvetica', 'normal');
    doc.text(content.keyword, margin + 30, infoY + 8);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Language:', margin + 5, infoY + 16);
    doc.setFont('helvetica', 'normal');
    doc.text(content.language || 'EN', margin + 30, infoY + 16);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Date:', margin + 5, infoY + 24);
    doc.setFont('helvetica', 'normal');
    doc.text(this.formatEuropeanDate(content.createdAt), margin + 30, infoY + 24);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Generated for:', margin + 5, infoY + 32);
    doc.setFont('helvetica', 'normal');
    const userText = user.name || user.email;
    const userLines = this.splitTextIntoLines(doc, userText, maxWidth - 35, margin + 30);
    doc.text(userLines[0], margin + 30, infoY + 32);
    
    y += 60;

    // SEO Score Section - Simple and Clean Design
    const seoScore = content.seoScore || 75;
    const scoreColor = this.getScoreColor(seoScore);
    const scoreHeight = 35;
    
    y = this.checkPageBreak(doc, y, scoreHeight + 10);
    
    // Simple container with light background
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, pageWidth - (margin * 2), scoreHeight, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, pageWidth - (margin * 2), scoreHeight, 'S');
    
    // Left side - Label
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text('SEO Score', margin + 12, y + 20);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('Content Quality Assessment', margin + 12, y + 28);
    
    // Right side - Score (centered)
    const scoreX = margin + (pageWidth - margin * 2) * 0.6;
    const scoreWidth = (pageWidth - margin * 2) * 0.4;
    const centerX = scoreX + scoreWidth / 2;
    
    // Score number - large and clear
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...scoreColor);
    doc.text(`${seoScore}`, centerX, y + 18, { align: 'center' });
    
    // "/100" text
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('/100', centerX, y + 28, { align: 'center' });
    
    // Reset colors
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    y += scoreHeight + 10;

    // Meta Information - Enhanced with full text display
    y = this.checkPageBreak(doc, y, 60);
    y = this.addSection(doc, 'Meta Information', y);
    y += 5;
    
    // Meta Title with full text wrapping
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text('Meta Title:', margin, y);
    
    doc.setFont('helvetica', 'normal');
    const metaTitle = content.metaTitle || 'N/A';
    const titleLines = this.splitTextIntoLines(doc, metaTitle, maxWidth - 30, margin + 30);
    let titleY = y;
    for (const line of titleLines) {
      if (titleY !== y) {
        titleY = this.checkPageBreak(doc, titleY, 8);
      }
      doc.text(line, margin + 30, titleY);
      titleY += 6;
    }
    y = titleY + 8;
    
    // Meta Description with full text wrapping
    doc.setFont('helvetica', 'bold');
    doc.text('Meta Description:', margin, y);
    
    doc.setFont('helvetica', 'normal');
    const metaDescription = content.metaDescription || 'N/A';
    const descLines = this.splitTextIntoLines(doc, metaDescription, maxWidth - 30, margin + 30);
    let descY = y;
    for (const line of descLines) {
      if (descY !== y) {
        descY = this.checkPageBreak(doc, descY, 8);
      }
      doc.text(line, margin + 30, descY);
      descY += 6;
    }
    y = descY + 10;

    // Content Stats
    y = this.checkPageBreak(doc, y, 30);
    y = this.addSection(doc, 'Content Statistics', y);
    y = this.addLine(doc, `Word Count: ${content.wordCount || 0}`, y);
    y = this.addLine(doc, `Keyword Density: ${content.keywordDensity || 'N/A'}`, y);
    y += 10;

    // Main Content
    y = this.checkPageBreak(doc, y, 30);
    y = this.addSection(doc, 'Content', y);
    y += 5;
    
    // Parse HTML into structured elements
    const htmlElements = this.parseHtmlForPDF(content.htmlContent || '');
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    
    for (const element of htmlElements) {
      if (element.type === 'heading') {
        y = this.checkPageBreak(doc, y, 20);
        
        // Set heading font size based on level
        const headingSizes = { 1: 16, 2: 14, 3: 12, 4: 11, 5: 10, 6: 10 };
        const fontSize = headingSizes[element.level] || 10;
        
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        
        const headingLines = this.splitTextIntoLines(doc, element.text, maxWidth, margin);
        for (const line of headingLines) {
          y = this.checkPageBreak(doc, y, fontSize + 2);
          doc.text(line, margin, y);
          y += fontSize + 2;
        }
        
        y += 3; // Extra space after heading
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0);
        
      } else if (element.type === 'list') {
        y = this.checkPageBreak(doc, y, 15);
        
        element.items.forEach((item, index) => {
          y = this.checkPageBreak(doc, y, 10);
          
          // List marker
          const marker = element.ordered ? `${index + 1}.` : '•';
          doc.setFont('helvetica', 'bold');
          doc.text(marker, margin, y);
          
          // List item text
          doc.setFont('helvetica', 'normal');
          const itemLines = this.splitTextIntoLines(doc, item, maxWidth - 15, margin + 10);
          let itemY = y;
          
          for (const line of itemLines) {
            if (itemY !== y) {
              itemY = this.checkPageBreak(doc, itemY, 8);
            }
            doc.text(line, margin + 10, itemY);
            itemY += 6;
          }
          
          y = itemY + 2;
        });
        
        y += 3; // Extra space after list
        
      } else if (element.type === 'paragraph') {
        y = this.checkPageBreak(doc, y, 12);
        
        // Handle paragraphs with proper line breaks
        const paragraphText = element.text.replace(/\n/g, ' ').trim();
        if (paragraphText) {
          const paraLines = this.splitTextIntoLines(doc, paragraphText, maxWidth, margin);
          
          for (const line of paraLines) {
            y = this.checkPageBreak(doc, y, 8);
            doc.text(line, margin, y);
            y += 6;
          }
          
          y += 4; // Space between paragraphs
        }
      }
    }
    
    y += 10;

    // FAQ Section
    if (content.faq && content.faq.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, 'Frequently Asked Questions', y);
      y += 5;
      
      doc.setFontSize(10);
      for (let i = 0; i < content.faq.length; i++) {
        const faq = content.faq[i];
        
        // Question with background
        y = this.checkPageBreak(doc, y, 25);
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, y - 8, pageWidth - (margin * 2), 12, 'F');
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(40, 40, 40);
        const questionLines = this.splitTextIntoLines(doc, `Q${i + 1}: ${faq.question}`, maxWidth - 10, margin + 5);
        let qY = y;
        for (const qLine of questionLines) {
          if (qY !== y) {
            qY = this.checkPageBreak(doc, qY, 8);
            doc.setFillColor(245, 245, 245);
            doc.rect(margin, qY - 8, pageWidth - (margin * 2), 12, 'F');
          }
          doc.text(qLine, margin + 5, qY);
          qY += 6;
        }
        y = qY + 3;
        
        // Answer
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0);
        const answerText = this.stripHtml(faq.answer || '').replace(/\n/g, ' ').trim();
        const answerLines = this.splitTextIntoLines(doc, answerText, maxWidth - 10, margin + 5);
        for (const aLine of answerLines) {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(aLine, margin + 5, y);
          y += 6;
        }
        y += 8; // Space between FAQ items
      }
    }

    // CTA Section
    if (content.cta) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, 'Call to Action', y);
      y += 5;
      
      // CTA box with border
      const ctaHeight = 30;
      y = this.checkPageBreak(doc, y, ctaHeight);
      
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(margin, y - 5, pageWidth - (margin * 2), ctaHeight, 'S');
      
      doc.setFillColor(250, 250, 250);
      doc.rect(margin + 0.5, y - 4.5, pageWidth - (margin * 2) - 1, ctaHeight - 1, 'F');
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      const ctaText = this.stripHtml(content.cta).replace(/\n/g, ' ').trim();
      const ctaLines = this.splitTextIntoLines(doc, ctaText, maxWidth - 20, margin + 10);
      
      let ctaY = y + 8;
      for (const ctaLine of ctaLines) {
        doc.text(ctaLine, margin + 10, ctaY);
        ctaY += 7;
      }
      
      y = ctaY + 5;
    }

    // Footer
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }
}

export const pdfService = new PDFService();
