import 'dotenv/config';

console.log('Email:', process.env.LINKEDIN_EMAIL);
console.log('Password:', process.env.LINKEDIN_PASSWORD ? '***found***' : 'NOT FOUND');