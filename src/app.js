const express = require('express');

const app = express();

app.use(express.json());

app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'MRO Server is running'
    });
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});