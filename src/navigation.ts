import {
  LayoutDashboard,
  Library,
  Flag,
  Radar,
  ChartNoAxesCombined,
  BookOpen,
  Orbit,
  Sparkles,
  Settings2,
} from 'lucide-vue-next';

export const navigation = [
  { to: '/', label: '今日训练', icon: LayoutDashboard, group: '训练', caption: '题单、周目标与未来计划' },
  { to: '/problems', label: '错题库', icon: Library, group: '训练', caption: '查找题目、记录思路与重做' },
  { to: '/contests', label: '比赛复盘', icon: Flag, group: '训练', caption: '比赛报告、赛后补题与模拟赛' },
  {
    to: '/insights',
    label: '数据总览',
    icon: Radar,
    group: '分析',
    caption: '多平台账号、能力雷达与趋势',
  },
  {
    to: '/statistics',
    label: '训练统计',
    icon: ChartNoAxesCombined,
    group: '分析',
    caption: '趋势、诊断与月度报告',
  },
  { to: '/knowledge', label: '知识中心', icon: BookOpen, group: '分析', caption: '算法知识、个人经验与图谱' },
  { to: '/growth', label: '成长收藏', icon: Orbit, group: '个人', caption: '学习里程碑与外观收藏' },
  { to: '/companion', label: '星澪伙伴', icon: Sparkles, group: '个人', caption: '结合学习证据的智能辅导' },
  {
    to: '/settings',
    label: '设置与数据',
    icon: Settings2,
    group: '设置',
    caption: '账号、同步、备份与 AI 配置',
  },
];

export const quickActions = [
  { to: '/?view=path', label: '学习路径', caption: '从基础到目标，查看先修关系与独立验证' },
  { to: '/problems?due=yes', label: '查看到期复习', caption: '优先处理积压的复习任务' },
  { to: '/?view=training', label: '调整未来计划', caption: '预览、查看与撤回未来安排' },
  { to: '/contests?view=upsolve', label: '打开赛后补题', caption: '继续完成比赛留下的题目' },
  { to: '/statistics?view=monthly', label: '查看月度报告', caption: '回顾训练变化和证据' },
  { to: '/settings?view=sync', label: '查看同步状态', caption: '检查提交同步与数据健康' },
  { to: '/settings?view=backup', label: '备份与恢复', caption: '保存一份完整的学习记录' },
];
