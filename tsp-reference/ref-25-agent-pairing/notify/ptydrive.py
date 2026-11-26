#!/usr/bin/env python3
"""Run a command in a pty, log its raw output, and type what arrives on a control FIFO.

usage: ptydrive.py <dir> -- <cmd...>
  <dir>/out.raw   raw terminal output
  <dir>/ctl       FIFO; each line is typed. Tokens: {ENTER} {ESC} {DOWN} {UP} {TAB} {STAB} {CTRLC}
  <dir>/pid       child pid; <dir>/exit the exit status
"""
import os, pty, sys, select, struct, fcntl, termios, time

d = sys.argv[1]
cmd = sys.argv[sys.argv.index('--') + 1:]
os.makedirs(d, exist_ok=True)
ctl = os.path.join(d, 'ctl')
if not os.path.exists(ctl):
    os.mkfifo(ctl)
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 140, 0, 0))
open(os.path.join(d, 'pid'), 'w').write(str(pid))
out = open(os.path.join(d, 'out.raw'), 'ab', buffering=0)
cfd = os.open(ctl, os.O_RDONLY | os.O_NONBLOCK)
TOK = {'{ENTER}': b'\r', '{ESC}': b'\x1b', '{DOWN}': b'\x1b[B', '{UP}': b'\x1b[A', '{TAB}': b'\t',
       '{STAB}': b'\x1b[Z', '{CTRLC}': b'\x03'}
buf = b''
while True:
    r, _, _ = select.select([fd, cfd], [], [], 1.0)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out.write(data)
    if cfd in r:
        data = os.read(cfd, 65536)
        if not data:
            os.close(cfd)
            cfd = os.open(ctl, os.O_RDONLY | os.O_NONBLOCK)
            continue
        buf += data
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            s = line.decode()
            i = 0
            while i < len(s):
                for k, v in TOK.items():
                    if s.startswith(k, i):
                        os.write(fd, v); i += len(k); time.sleep(0.15); break
                else:
                    os.write(fd, s[i].encode()); i += 1
                    time.sleep(0.01)
_, st = os.waitpid(pid, 0)
open(os.path.join(d, 'exit'), 'w').write(str(st))
