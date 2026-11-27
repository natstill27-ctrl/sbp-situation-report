<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet
  version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom"
  exclude-result-prefixes="atom"
>
  <xsl:output method="html" encoding="UTF-8" indent="yes" />

  <xsl:template match="/">
    <html lang="th">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/jpeg" href="./wing56-logo.jpg" />
        <title>
          <xsl:value-of select="/rss/channel/title" /> — RSS 2.0 Feed
        </title>
        <style>
          :root {
            --bg-page: #f4f6f9;
            --bg-card: #ffffff;
            --bg-subtle: #f8fafc;
            --text-main: #162032;
            --text-muted: #5f6e85;
            --border: #d8e0eb;
            --navy: #0c192c;
            --blue: #1d5bb8;
            --blue-bg: #e8f0fc;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg-page: #141923;
              --bg-card: #1b2230;
              --bg-subtle: #202838;
              --text-main: #e2e8f0;
              --text-muted: #94a3b8;
              --border: #2b3446;
              --navy: #0b1120;
              --blue: #5ba4f5;
              --blue-bg: rgba(91, 164, 245, 0.14);
            }
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            font-family: 'Noto Sans Thai', 'Sarabun', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg-page);
            color: var(--text-main);
            line-height: 1.6;
          }
          .rss-header {
            background: var(--navy);
            color: #ffffff;
            border-bottom: 3px solid #c9971a;
            padding: 1.25rem 1rem;
          }
          .rss-wrap {
            max-width: 960px;
            margin: 0 auto;
            padding: 0 1rem;
          }
          .rss-header-inner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            flex-wrap: wrap;
          }
          .rss-brand {
            display: flex;
            align-items: center;
            gap: 0.85rem;
          }
          .rss-emblem {
            width: 50px;
            height: 50px;
            border-radius: 11px;
            background: #ffffff;
            padding: 3px;
            flex-shrink: 0;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
          }
          .rss-emblem img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
          }
          .rss-title {
            margin: 0;
            font-size: 1.2rem;
            font-weight: 700;
          }
          .rss-subtitle {
            margin: 0.2rem 0 0;
            font-size: 0.86rem;
            color: #cbd5e1;
          }
          .rss-back-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.5rem 0.9rem;
            border-radius: 8px;
            background: #1d5bb8;
            color: #ffffff;
            text-decoration: none;
            font-weight: 700;
            font-size: 0.86rem;
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          .rss-back-btn:hover {
            background: #164996;
          }
          .rss-main {
            padding: 1.25rem 0 2.5rem;
          }
          .rss-info-box {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-left: 4px solid var(--blue);
            border-radius: 12px;
            padding: 0.95rem 1.1rem;
            margin-bottom: 1.15rem;
          }
          .rss-info-title {
            margin: 0 0 0.25rem;
            font-size: 0.95rem;
            font-weight: 700;
            color: var(--blue);
          }
          .rss-info-text {
            margin: 0;
            font-size: 0.86rem;
            color: var(--text-muted);
          }
          .rss-url-row {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            flex-wrap: wrap;
            margin-top: 0.6rem;
          }
          .rss-url-code {
            display: inline-block;
            padding: 0.32rem 0.65rem;
            border-radius: 7px;
            background: var(--bg-subtle);
            border: 1px solid var(--border);
            color: var(--text-main);
            font-size: 0.82rem;
            user-select: all;
            word-break: break-all;
          }
          .rss-meta-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-bottom: 0.9rem;
            font-size: 0.84rem;
            color: var(--text-muted);
          }
          .rss-items {
            display: flex;
            flex-direction: column;
            gap: 0.85rem;
          }
          .rss-item-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1rem 1.1rem;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
          }
          .rss-item-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-bottom: 0.45rem;
          }
          .rss-cat-badge {
            display: inline-block;
            padding: 0.14rem 0.58rem;
            border-radius: 999px;
            background: var(--blue-bg);
            color: var(--blue);
            font-size: 0.78rem;
            font-weight: 700;
          }
          .rss-date {
            font-size: 0.78rem;
            color: var(--text-muted);
          }
          .rss-item-title {
            margin: 0 0 0.45rem;
            font-size: 1.02rem;
            line-height: 1.45;
          }
          .rss-item-title a {
            color: var(--text-main);
            text-decoration: none;
          }
          .rss-item-title a:hover {
            color: var(--blue);
            text-decoration: underline;
          }
          .rss-item-desc {
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-muted);
          }
        </style>
      </head>
      <body>
        <header class="rss-header">
          <div class="rss-wrap rss-header-inner">
            <div class="rss-brand">
              <div class="rss-emblem">
                <img src="./wing56-logo.jpg" alt="ตราสัญลักษณ์ กองบิน 56" />
              </div>
              <div>
                <h1 class="rss-title">
                  <xsl:value-of select="/rss/channel/title" />
                </h1>
                <p class="rss-subtitle">
                  <xsl:value-of select="/rss/channel/description" />
                </p>
              </div>
            </div>
            <a class="rss-back-btn" href="{/rss/channel/link}">
              กลับหน้าศูนย์ข่าวกรองรายวัน
            </a>
          </div>
        </header>

        <main class="rss-wrap rss-main">
          <section class="rss-info-box">
            <p class="rss-info-title">ฟีดข่าวมาตรฐาน RSS 2.0 XML (มสพร. 11-2566)</p>
            <p class="rss-info-text">
              หน้านี้แปลงผลจากไฟล์ XML มาตรฐานเพื่อให้อ่านง่ายในเบราว์เซอร์ สามารถคัดลอกลิงก์ฟีดด้านล่างไปเชื่อมต่อในโปรแกรมอ่านข่าว RSS, Microsoft Teams, Feedly หรือระบบอัตโนมัติของหน่วยงานได้ทันที
            </p>
            <div class="rss-url-row">
              <strong>URL ฟีด:</strong>
              <code class="rss-url-code">
                <xsl:value-of select="/rss/channel/atom:link/@href" />
              </code>
            </div>
          </section>

          <div class="rss-meta-bar">
            <span>
              จำนวนข่าวในฟีด: <strong><xsl:value-of select="count(/rss/channel/item)" /></strong> รายการ
            </span>
            <span>
              อัปเดตล่าสุด: <strong><xsl:value-of select="/rss/channel/lastBuildDate" /></strong>
            </span>
          </div>

          <section class="rss-items" aria-label="รายการข่าวในฟีด RSS 2.0">
            <xsl:for-each select="/rss/channel/item">
              <article class="rss-item-card">
                <div class="rss-item-top">
                  <span class="rss-cat-badge">
                    <xsl:value-of select="category" />
                  </span>
                  <span class="rss-date">
                    <xsl:value-of select="pubDate" />
                  </span>
                </div>
                <h2 class="rss-item-title">
                  <a href="{link}" target="_blank" rel="noopener noreferrer">
                    <xsl:value-of select="title" />
                  </a>
                </h2>
                <p class="rss-item-desc">
                  <xsl:value-of select="description" />
                </p>
              </article>
            </xsl:for-each>
          </section>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
