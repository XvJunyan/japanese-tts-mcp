#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { z } = require('zod');
const os = require('os');

// 解析命令行参数
const args = process.argv.slice(2);
// 默认保存目录现在从环境变量获取，如果未设置则使用临时目录
let saveDir = process.env.BAIDU_TTS_SAVE_DIR || null;

// 从环境变量获取API配置
const API_URL = process.env.BAIDU_TTS_API_URL;
const API_KEY = process.env.BAIDU_TTS_API_KEY;
const MODEL = process.env.BAIDU_TTS_MODEL;

// 仍然保留命令行参数来覆盖环境变量（优先级高于环境变量）
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save-dir' && i + 1 < args.length) {
        saveDir = args[i + 1];
        i++;
    }
}

// 确保保存目录存在
if (!fs.existsSync(saveDir)) {
    try {
        fs.mkdirSync(saveDir, { recursive: true });
        console.error(`[Japanese TTS MCP] 创建音频保存目录: ${saveDir}`);
    } catch (err) {
        console.error(`[Japanese TTS MCP] 创建音频保存目录失败: ${err.message}`);
        console.error(`[Japanese TTS MCP] 将使用临时目录: ${os.tmpdir()}`);
        saveDir = os.tmpdir();
    }
}

console.error(`[Japanese TTS MCP] 直接连接到百度API: ${API_URL}`);
console.error(`[Japanese TTS MCP] 音频文件将保存到: ${saveDir}`);

// 播放音频文件
function playAudioFile(filePath) {
    return new Promise((resolve, reject) => {
        let command;
        
        if (process.platform === 'win32') {
            command = `start ${filePath}`;
        } else if (process.platform === 'darwin') {
            command = `afplay ${filePath}`;
        } else {
            command = `aplay ${filePath}`;
        }
        
        exec(command, (error) => {
            if (error) {
                console.error(`[Japanese TTS MCP] 播放音频失败: ${error.message}`);
                // 即使播放失败也继续执行
                resolve();
            } else {
                resolve();
            }
        });
    });
}

// 保存音频文件（从Base64编码数据）
async function saveAudioFile(audioData, format = 'mp3') {
    try {
        // 从Base64解码
        const buffer = Buffer.from(audioData, 'base64');
        
        // 创建文件名
        const timestamp = Date.now();
        const fileName = `tts-${timestamp}.${format}`;
        const filePath = path.join(saveDir, fileName);
        
        // 保存文件
        fs.writeFileSync(filePath, buffer);
        console.error(`[Japanese TTS MCP] 音频文件已保存: ${filePath}`);
        
        return filePath;
    } catch (error) {
        console.error(`[Japanese TTS MCP] 保存音频文件失败: ${error.message}`);
        throw error;
    }
}

// 创建MCP服务器
const server = new McpServer({
    name: "JapaneseTTS",
    version: "1.0.0"
});

// 添加文本转语音工具
server.tool(
    "speak",
    {
        text: z.string().describe("需要转换为语音的文本"),
        modelType: z.number().default(10).describe("模型类型 (8: 网红定制imma, 9: 关西腔, 10: 二次元, 11: ASMR特色, 101: 英语)"),
        speakerId: z.number().default(0).describe("说话人ID"),
        speed: z.number().default(1.0).describe("语速 (0-3)"),
        volume: z.number().default(1.0).describe("音量 (0-3)")
    },
    async ({ text, modelType = 10, speakerId = 0, speed = 1.0, volume = 1.0 }) => {
        try {
            console.error(`[Japanese TTS MCP] 处理TTS请求: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
            
            // 创建FormData
            const formData = new FormData();
            
            // 添加必要参数
            formData.append('text', text);
            formData.append('model_type', modelType.toString());
            formData.append('spk_id', speakerId.toString());
            formData.append('speed', speed.toString());
            formData.append('volume', volume.toString());
            formData.append('sample_rate', '22050');
            formData.append('audio_type', 'mp3');
            
            // 发送请求到百度API
            const response = await axios.post(API_URL, formData, {
                headers: {
                    apikey: API_KEY,
                    Model: MODEL,
                    ...formData.getHeaders()
                }
            });
            
            // 检查响应
            if (response.status !== 200 || !response.data || !response.data.result || !response.data.result.audio) {
                throw new Error(`API错误: ${JSON.stringify(response.data)}`);
            }
            
            // 保存音频文件
            const audioFilePath = await saveAudioFile(response.data.result.audio);
            
            // 播放音频
            await playAudioFile(audioFilePath);
            
            // 计算音频时长（如果API返回了）
            const duration = response.data.result.duration || '未知';
            
            // 按照截图格式返回信息
            return {
                content: [
                    { 
                        type: "text", 
                        text: `{\n  "text": "${text}"\n}`
                    }
                ],
                result: `已成功播放语音: "${text}" (文件: ${audioFilePath})`
            };
        } catch (error) {
            console.error(`[Japanese TTS MCP] 错误: ${error.message}`);
            return {
                content: [
                    { type: "text", text: `TTS服务错误: ${error.message}` }
                ],
                isError: true
            };
        }
    }
);

// 添加获取模型信息工具
// server.tool(
//     "getModels",
//     {},
//     async () => {
//         try {
//             // 硬编码模型信息，跳过中间服务
//             const models_info = {
//                 "8": {"name": "网红定制imma模型", "speakers": Array.from({length: 3}, (_, i) => i), "description": "共计3种说话风格"},
//                 "9": {"name": "关西腔模型", "speakers": Array.from({length: 10}, (_, i) => i), "description": "共计10个说话人"},
//                 "10": {"name": "二次元模型", "speakers": Array.from({length: 1104}, (_, i) => i), "description": "共计1104个说话人，共56种风格"},
//                 "11": {"name": "ASMR特色模型", "speakers": Array.from({length: 4}, (_, i) => i), "description": "共计4个说话人"},
//                 "101": {"name": "英语模型", "speakers": Array.from({length: 112}, (_, i) => i), "description": "共计112个说话人，其他8个音色可用"}
//             };
            
//             return {
//                 content: [
//                     { type: "text", text: JSON.stringify(models_info, null, 2) }
//                 ]
//             };
//         } catch (error) {
//             console.error(`获取模型信息失败: ${error.message}`);
//             return {
//                 content: [
//                     { type: "text", text: `获取模型信息失败: ${error.message}` }
//                 ],
//                 isError: true
//             };
//         }
//     }
// );

// 添加查询当前配置工具
// server.tool(
//     "getConfig",
//     {},
//     async () => {
//         const config = {
//             api_url: API_URL,
//             save_directory: saveDir,
//             model: MODEL
//         };

//         return {
//             content: [
//                 { type: "text", text: JSON.stringify(config, null, 2) }
//             ]
//         };
//     }
// );

// 启动服务器
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
    console.error('[Japanese TTS MCP] 服务器已启动');
    console.error(`[Japanese TTS MCP] 配置信息:`);
    console.error(`  - API URL: ${API_URL}`);
    console.error(`  - 音频保存目录: ${saveDir}`);
}).catch(err => {
    console.error(`[Japanese TTS MCP] 服务器启动失败: ${err.message}`);
    process.exit(1);
});