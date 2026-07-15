# Checkout module boundary

Chunk 1 will place checkout domain logic and route-specific application code in
this directory. Test-support endpoints and stable `data-formcrash` selectors must
remain owned by this application; they must not depend on the FormCrash control
server.
