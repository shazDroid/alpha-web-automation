import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../src/ui/App'
import {createTheme, localStorageColorSchemeManager, MantineProvider,} from '@mantine/core'
import '@mantine/core/styles.css'

const theme = createTheme({
    defaultRadius: 'md',
})

const colorSchemeManager = localStorageColorSchemeManager({
    key: 'alpha-color-scheme',
})

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <MantineProvider
            theme={theme}
            defaultColorScheme="auto"
            colorSchemeManager={colorSchemeManager}
        >
            <App/>
        </MantineProvider>
    </React.StrictMode>
)
