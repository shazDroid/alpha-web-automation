import {useEffect, useMemo, useRef, useState} from 'react'
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Textarea,
  TextInput,
  Title,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import {IconChevronDown, IconChevronUp, IconMoon, IconPlayerPlay, IconSun, IconTrash} from '@tabler/icons-react'


declare global {
  interface Window {
    alpha?: {
      runTask(task: string): Promise<{ ok: boolean; runId: string; result?: any; error?: string }>
      stop(): Promise<any>
      takeOver(): Promise<any>
      resume(): Promise<any>
      onLog?(cb: (p: { runId: string; level: 'info' | 'error'; msg: string; at?: number }) => void): () => void
      showInFolder(filePath: string): Promise<any>
    }
  }
}

const alpha = () => (window as any).alpha as Window['alpha'] | undefined;


type Session = {
  id: string
  runId?: string
  startedAt: string
  task: string
  logs: string[]
  collapsed?: boolean
  status: 'running' | 'done' | 'failed'
}


function humanizeResult(res: any): string[] {
  if (!res) return ['done']
  if (typeof res === 'string') return [res]

  const out: string[] = []
  if (res.ok === false && res.error) return [`failed: ${res.error}`]

  const r = res.result
  if (!r) return ['done']

  if (typeof r === 'object' && !Array.isArray(r)) {
    if (r.url) out.push(`url: ${r.url}`)
    if (r.title) out.push(`title: ${r.title}`)
    if (r.h1) out.push(`h1: ${r.h1}`)
    Object.keys(r).forEach(k => {
      if (['url','title','h1'].includes(k)) return
      const v = r[k]
      if (v != null && typeof v !== 'object') out.push(`${k}: ${String(v)}`)
    })
    if (out.length) return out
  }

  if (Array.isArray(r)) {
    for (const item of r) {
      if (item?.selector && item?.text != null) out.push(`${item.selector} -> ${item.text}`)
      else out.push(String(item))
    }
    if (out.length) return out
  }

  return ['done']
}

export default function App() {
  const [url, setUrl] = useState('https://example.com')
  const [task, setTask] = useState('open https://example.com -> getText h1')
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')

  const [sessions, setSessions] = useState<Session[]>([])
  const currentRunId = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const {setColorScheme} = useMantineColorScheme()
  const computed = useComputedColorScheme('light', {getInitialValueInEffect: true})
  const toggleColorScheme = () =>
      setColorScheme(computed === 'dark' ? 'light' : 'dark')


  useEffect(() => {
    const off = alpha()?.onLog?.((p) => {
      if (!p?.msg) console.warn("log without msg:", p);
      // Route to the matching session (by runId)
      setSessions((prev) => {
        const idx = prev.findIndex(s => s.runId === p.runId)
        if (idx === -1) return prev // late log after Clear, ignore
        const s = prev[idx]

        // build the display line
        const prefix = p.level === 'error' ? '❌ ' : ''
        const line = prefix + p.msg

        // once failed, stay failed
        const nextStatus: Session['status'] =
            s.status === 'failed' ? 'failed' : (p.level === 'error' ? 'failed' : s.status)

        const updated: Session = {
          ...s,
          status: nextStatus,
          logs: [stamp(line), ...s.logs].slice(0, 500),
        }
        const out = prev.slice()
        out[idx] = updated
        return out
      })
    })
    return () => off?.()
  }, [])


  function startSession(initialTask: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    currentRunId.current = id
    const s: Session = {
      id,
      startedAt: time(),
      task: initialTask,
      logs: [`▶ ${initialTask}`],
      status: 'running',
    }
    setSessions((prev) => [s, ...prev])
  }

  function appendLogToActiveSession(line: string) {
    setSessions((prev) => {
      if (prev.length === 0) return prev
      const [head, ...tail] = prev

      // once failed, stay failed (don't flip to done if a later ✔ arrives)
      const nextStatus =
          head.status === 'failed'
              ? 'failed'
              : line.startsWith('❌')
                  ? 'failed'
                  : line.startsWith('✔')
                      ? 'done'
                      : head.status

      const updated: Session = {
        ...head,
        logs: [stamp(line), ...head.logs].slice(0, 500),
        status: nextStatus,
      }
      return [updated, ...tail]
    })

    queueMicrotask(() => {
      const el = listRef.current
      if (el) el.scrollTop = 0
    })
  }

  const api = alpha();



  const onRun = async () => {
    if (!task.trim()) return;

    // 1) create a UI session immediately
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const initial: Session = {
      id: localId,
      startedAt: time(),
      task,
      logs: [stamp(`▶ ${task}`)],
      status: 'running',
    };
    setSessions((prev) => [initial, ...prev]);

    // 2) bridge check
    const api = alpha();
    if (!api?.runTask) {
      // mark the just-created session as failed (typed as Session)
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === localId);
        if (idx === -1) return prev;
        const cur = prev[idx];
        const updated: Session = {
          ...cur,
          status: 'failed',
          logs: [stamp('❌ Electron bridge not ready'), ...cur.logs],
        };
        const out = prev.slice();
        out[idx] = updated;
        return out;
      });
      return;
    }

    // 3) run the agent
    const res = await api.runTask(task).catch((e) => ({ ok: false, error: String(e) } as any));

    // 4) attach runId + finalize with typed updates
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === localId);
      if (idx === -1) return prev;

      const cur = prev[idx];
      const withRunId: Session = { ...cur, runId: (res as any).runId };

      const ok = (res as any)?.ok !== false;
      const lines = humanizeResult(res);
      const prefix = ok ? '✔ ' : '❌ ';
      const appended = (lines.length ? lines : [ok ? 'done' : String((res as any)?.error ?? 'failed')])
          .map((l) => stamp(prefix + l));

      const updated: Session = {
        ...withRunId,
        status: ok ? 'done' : 'failed',
        logs: [...appended, ...withRunId.logs].slice(0, 500),
      };

      const out = prev.slice();
      out[idx] = updated;
      return out;
    });
  };



  const onStop     = async () => { appendLogToActiveSession('⏹ stop requested'); await alpha()?.stop?.().catch(() => {}); };
  const onTakeOver = async () => { setMode('manual'); appendLogToActiveSession('🧑‍💻 take over (manual)'); await alpha()?.takeOver?.().catch(() => {}); };
  const onResume   = async () => { setMode('auto');   appendLogToActiveSession('▶ resume (auto)');      await alpha()?.resume?.().catch(() => {}); };

  const showInFolder = (p: string) => {
    (window as any).alpha?.showInFolder?.(p);
  };

  const clearSessions = () => setSessions([])

  return (
      <AppShell header={{ height: 56 }} padding="md" navbar={{ width: 420, breakpoint: 'sm' }}>
        <AppShell.Header>
          <Group px="md" h="100%" justify="space-between">
            <Group gap="sm">
              <Title order={4}>Alpha Web Automation</Title>
              <Badge color={mode === 'auto' ? 'green' : 'yellow'} variant="filled">
                {mode === 'auto' ? 'Auto' : 'Manual'}
              </Badge>
            </Group>

            <Group gap="xs">
              <Button variant="default" onClick={onTakeOver}>Take over</Button>
              <Button variant="default" onClick={onResume}>Resume</Button>
              <Button color="red" onClick={onStop}>Stop</Button>
              <ActionIcon
                  variant="default"
                  onClick={toggleColorScheme}
                  title="Toggle color scheme"
                  aria-label="Toggle color scheme"
              >
                {computed === 'dark' ? <IconSun size={16}/> : <IconMoon size={16}/>}
              </ActionIcon>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          <Group justify="space-between" mb="xs">
            <Title order={6}>Timeline</Title>
            <Button size="xs" variant="subtle" onClick={clearSessions} leftSection={<IconTrash size={14} />}>
              Clear
            </Button>
          </Group>

          <ScrollArea h="48vh">
            <Stack gap="xs" ref={listRef as any}>
              {sessions.map((s) => (
                  <Card key={s.id} withBorder radius="md" padding="sm">
                    <Group justify="space-between" mb="xs">
                      <Group gap="xs">
                        <Badge size="sm" color={s.status === 'running' ? 'blue' : s.status === 'done' ? 'green' : 'red'}>
                          {s.status}
                        </Badge>
                        <Title order={6}>{s.task.length > 52 ? s.task.slice(0, 52) + '…' : s.task}</Title>
                      </Group>
                      <Group gap="xs">
                        <Badge variant="light">{s.startedAt}</Badge>
                        <ActionIcon
                            variant="subtle"
                            onClick={() =>
                                setSessions((prev) =>
                                    prev.map((x) => (x.id === s.id ? { ...x, collapsed: !x.collapsed } : x)),
                                )
                            }
                            title={s.collapsed ? 'Expand' : 'Collapse'}
                        >
                          {s.collapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
                        </ActionIcon>
                      </Group>
                    </Group>
                    {!s.collapsed && (
                        <Stack gap={6}>
                          {s.logs.map((l, i) => (
                              <LogLine key={i} line={l} />
                          ))}
                        </Stack>
                    )}
                  </Card>
              ))}
            </Stack>
          </ScrollArea>

          <Divider my="sm" />

          <Title order={6} mt="sm" mb="xs">Task</Title>
          <Stack gap="xs">
            <Textarea
                minRows={3}
                maxRows={8}
                autosize
                value={task}
                onChange={(e) => setTask(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onRun()
                  }
                }}
                placeholder="Describe a task… (use '->' between steps)"
            />
            <Group justify="flex-end">
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={onRun}>
                Run
              </Button>
            </Group>
          </Stack>
        </AppShell.Navbar>

        <AppShell.Main>
          <Tabs defaultValue="browser">
            <Tabs.List>
              <Tabs.Tab value="browser">Browser</Tabs.Tab>
              <Tabs.Tab value="graph">Flow Graph</Tabs.Tab>
              <Tabs.Tab value="kg">Knowledge Graph</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="browser" pt="md">
              <Group gap="sm" mb="sm">
                <TextInput w={520} value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://…" />
                <Button onClick={() => (document.getElementById('alpha-webview') as any)?.loadURL?.(url)}>Go</Button>
              </Group>
              <webview
                  id="alpha-webview"
                  partition="persist:agent"
                  style={{ width: '100%', height: '72vh', border: '1px solid #eee', borderRadius: 8 }}
                  src={url}
                  allowpopups
              />
            </Tabs.Panel>

            <Tabs.Panel value="graph" pt="md">
              <Card withBorder radius="md">Flow graph will render here.</Card>
            </Tabs.Panel>

            <Tabs.Panel value="kg" pt="md">
              <Card withBorder radius="md">Knowledge graph viewer.</Card>
            </Tabs.Panel>
          </Tabs>
        </AppShell.Main>
      </AppShell>
  )
}

function time() {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function stamp(line: string) {
  return `${time()} ${line}`
}

function colorFor(line: string): { color: string } {
  if (line.includes('❌')) return { color: '#b00020' }
  if (line.includes('✔')) return { color: '#0a7d00' }
  if (line.includes('▶')) return { color: '#0b5fff' }
  if (line.includes('⏹')) return { color: '#b05a00' }
  if (line.includes('🧑‍💻')) return { color: '#8a6d3b' }
  return { color: '#222' }
}

function LogLine({ line }: { line: string }) {
  const style = useMemo(() => {
    const c = colorFor(line)
    return { color: c.color, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12.5 }
  }, [line])

  const shot = parseScreenshot(line) // if you added screenshot rendering earlier
  const dl = parseDownloadPath(line)

  return (
      <div style={{ marginTop: 4, marginBottom: 4 }}>
        <div style={style}>{line}</div>
        {shot && (
            <img
                src={shot}
                alt="screenshot"
                style={{ marginTop: 6, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', maxWidth: '100%' }}
            />
        )}
        {dl && (
            <div style={{ marginTop: 6 }}>
              <Button size="xs" variant="light" onClick={() => alpha()?.showInFolder?.(dl)}>
                Show in folder
              </Button>
            </div>
        )}
      </div>
  )
}



function parseScreenshot(line: string): string | null {
  // Expected: "🖼 screenshot: <pathOrUrl>"
  const m = line.match(/🖼\s*screenshot:\s*(.+)$/)
  if (!m) return null
  const src = m[1].trim()
  // electron can load file:// URLs; for Windows paths, add the prefix
  if (/^https?:\/\//i.test(src)) return src
  if (/^file:\/\//i.test(src)) return src
  // treat as absolute/relative file path
  return `file://${src.replace(/\\/g, '/')}`
}

function parseDownloadPath(line: string): string | null {
  // e.g. "downloaded -> C:\path\to\file.pdf"
  const m = line.match(/downloaded\s*->\s*(.+)$/i)
  return m ? m[1].trim() : null
}


