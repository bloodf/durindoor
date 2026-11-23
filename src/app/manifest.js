export default function manifest() {
  return {
    name: 'DurinDoor - AI Gateway',
    short_name: 'DurinDoor',
    description: 'One stable API in front of many upstream AI providers. Self-hosted OpenAI-compatible gateway.',
    start_url: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`,
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    orientation: 'portrait-primary',
    icons: [
      {
        src: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icons/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icons/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icons/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
