import { NextRequest, NextResponse } from 'next/server';
import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export const maxDuration = 15; // Allow 15s for the PDF generation

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    
    // Check if we are in development environment
    const isLocal = process.env.NODE_ENV === 'development';
    
    let browser;
    if (isLocal) {
      // In local dev, use the full puppeteer package without sparticuz
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteerDev = require('puppeteer');
      browser = await puppeteerDev.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: 'new'
      });
    } else {
      browser = await puppeteerCore.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true, // or 'new' depending on chromium version
      });
    }

    const page = await browser.newPage();
    
    // Build the absolute URL to access the hidden print layout
    const origin = req.nextUrl.origin;
    const printUrl = `${origin}/results/${runId}/print`;

    console.log(`Generating PDF for: ${printUrl}`);

    // Wait for the page to fully load and Recharts animations to finish
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '10mm',
        right: '10mm'
      }
    });

    await browser.close();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="PET_Report_${runId.substring(0,8)}.pdf"`,
      },
    });

  } catch (error) {
    console.error('Failed to generate PDF:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
