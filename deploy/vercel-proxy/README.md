# Public address

The service runs on a single VM. This directory is a Vercel project whose only job is to give it a stable,
readable address: every request is rewritten to the VM. Nothing is built or stored here.

The rewrite targets a hostname derived from the VM's address. That address is reserved as a static IP for the VM; if
the VM is ever replaced, change the destination here before releasing the address, or the public name would point
at whoever receives it next.
