import { NextRequest, NextResponse } from 'next/server';
import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export const maxDuration = 30; // Increase to 30s to allow for cold start and chart rendering on Vercel (capped for Hobby at 10s, but beneficial for Pro)

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  let browser;
  try {
    const { runId } = await params;
    
    // Check if we are in development environment
    const isLocal = process.env.NODE_ENV === 'development';
    
    console.log(`[PDF] Starting generation for runId: ${runId} (Local: ${isLocal})`);

    if (isLocal) {
      // In local dev, use the full puppeteer package
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteerDev = require('puppeteer');
      browser = await puppeteerDev.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: 'new'
      });
    } else {
      // Configure sparticuz/chromium for Vercel
      console.log('[PDF] Launching chromium via puppeteer-core on Vercel...');
      
      const executablePath = await chromium.executablePath(
        `https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar`
      );
      console.log(`[PDF] Remote executable path retrieved: ${executablePath ? 'OK' : 'EMPTY'}`);

      browser = await puppeteerCore.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
        executablePath: executablePath || '',
        headless: true,
        defaultViewport: { width: 1080, height: 1600 },
      });
    }

    const page = await browser.newPage();
    
    // Build the absolute URL to access the hidden print layout
    let origin = req.nextUrl.origin;
    // On Vercel, prioritize using the system VERCEL_URL for internal navigation to avoid DNS issues with custom domains
    if (process.env.VERCEL_URL && !origin.includes('localhost')) {
      origin = `https://${process.env.VERCEL_URL}`;
    }
    
    const printUrl = `${origin}/results/${runId}/print`;

    console.log(`[PDF] Using origin: ${origin}, navigating to: ${printUrl}`);

    // Wait for the page to fully load
    // Use 'networkidle2' which is more permissive than 'networkidle0' (good for sites with analytics)
    await page.goto(printUrl, { waitUntil: 'networkidle2', timeout: 25000 });

    // Wait an extra 500ms for charts to stabilize (even if animations are disabled)
    await new Promise(r => setTimeout(r, 800));

    console.log('[PDF] Generating PDF buffer...');
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

    console.log(`[PDF] Success! Buffer length: ${pdfBuffer.length} bytes`);

    await browser.close();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="PET_Report_${runId.substring(0,8)}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error: any) {
    console.error('[PDF] Critical error generating PDF:', error);
    
    if (browser) {
      try { await browser.close(); } catch (e) { console.error('[PDF] Error closing browser:', e); }
    }

    return new NextResponse(JSON.stringify({ 
      error: 'Failed to generate PDF', 
      details: error?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

