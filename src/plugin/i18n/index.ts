import { moment } from 'obsidian';
import { en } from './en';
import { zhCn } from './zh-cn';

export type I18nStrings = typeof zhCn;

export function t(): I18nStrings {
    const locale = moment.locale();
    return locale.startsWith('zh') ? zhCn : en;
}
