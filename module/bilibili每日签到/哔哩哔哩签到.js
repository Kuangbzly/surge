/*
哔哩哔哩每日任务(V1.5)

更新时间: 2025-05-16
脚本兼容: Surge
脚本作者: MartinsKing（@ClydeTime）
*/

const format = (ts, fmt = 'yyyy-MM-dd HH:mm:ss') => {
	return $.time(fmt, ts)
}

const check = key =>
	!config.hasOwnProperty(key) ||
	!config[key].hasOwnProperty("time") ||
	!(config[key]["num"] > 0) ||
	format(new Date().toDateString()) > config[key].time

const string2object = cookie => {
	let obj = {}
	let arr = cookie.split("; ")
	arr.forEach(function (val) {
		let array = val.split("=")
		obj[array[0]] = array[1]
	})
	return obj
}

const isNotComplete = exec_times => 
	config.user.num === 0 ||
	config.watch.num === 0 ||
	config.share.num === 0 ||
	(config.coins.num < exec_times * 10 && Math.floor(config.user.money) > 5)

const generateSign = body => md5(
	$.queryStr(Object.fromEntries(new Map(Array.from(Object.entries(body)).sort()))) 
	+ 'c2ed53a74eeefe3cf99fbd01d8c9c375'
)

const persistentStore = config => {
	const PStoreConfig = $.getItem($.name + "_daily_bonus", {})
	const isCookieValid = PStoreConfig.cookie?.bili_jct === config.cookie.bili_jct
	const isSameUser = PStoreConfig.cookie?.DedeUserID === config.cookie.DedeUserID
	if (PStoreConfig.cookie && !isCookieValid) {
		!isSameUser && (config = PStoreConfig?.Settings ? {...config, Settings: PStoreConfig.Settings} : config)
		config.FirstInsert = false
	} else if (PStoreConfig.cookie) {
		return $.log("- cookie未失效,无需更新")
	} else {
		config.FirstInsert = true
	}
	const isFirstInsert = config.FirstInsert
	delete config.FirstInsert
	const successMessage = $.setItem($.name + "_daily_bonus", $.toStr(config))
		? "🎉cookie存储成功"
		: "🤒cookie存储失败"
	$.msg($.name, isFirstInsert ? "首次获取cookie" : "检测到cookie已更新", successMessage)
	$.log($.name + ": " +`${isFirstInsert ? "首次获取cookie" : "检测到cookie已更新"}`)
	$.log(successMessage)
}

const $ = new Env("bilibili")
const startTime = format()
let cards = []
let config = $.getItem($.name + "_daily_bonus", {});
[['cookie'], ['user'], ['watch'], ['share'], ['coins']].forEach(key => !config[key] && (config[key] = {})) //init config

const baseHeaders = {
	'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/621.1.15.10.7 (KHTML, like Gecko) Mobile/22E252 BiliApp/84400100 os/ios model/iPhone 16 Pro Max mobi_app/iphone build/84400100 osVer/18.3 network/2 channel/AppStore c_locale/zh-Hans_CN s_locale/zh-Hans_CN disable_rcmd/0',
	'cookie': config.cookieStr
}

!(async () => {
	if ("object" === typeof $response) {
		if(!config.matchTime || (Date.now() - config.matchTime) > 10000) {
			config.matchTime = Date.now()
			$.setItem($.name + "_daily_bonus", $.toStr(config))
		} else {
			if ((Date.now() - config.matchTime) < 10000) return $.log("- Blocked: interval <10s")
		}
		$.log("- 正在获取cookie, 请稍后")
		await getCookie()
	} else if ("object" === typeof $request) {
		let Cookie = $request.headers.cookie || $request.headers.Cookie
		if (Cookie) {
			config.cookie = string2object(Cookie)
			if (config.cookie.DedeUserID) {
				const url = $request.url
				config.key = url.match(/.*access_key=(.*?)&/)?.[1]
				config.cookieStr = `DedeUserID=${config.cookie.DedeUserID}; DedeUserID__ckMd5=${config.cookie.DedeUserID__ckMd5}; SESSDATA=${config.cookie.SESSDATA}; bili_jct=${config.cookie.bili_jct}; sid=${config.cookie.sid}`
			} else {
				return $.msg($.name, "- 获取cookie信息异常")
			}
			persistentStore(config)
		} else {
			$.msg($.name, "- 未发现有效cookie信息")
		}
	} else {
		await signBiliBili()
	}
})()
	.catch((e) => $.logErr(e))
	.finally(() => $.done())

// ...（getCookie、waitConfirmLoop、getQrcode、loginConfirm、watch、share、silver2coin、liveSign、bigScoreSign 等所有函数保持完全不变）

async function coin() {
	if (config.coins.num >= 50) {
		$.log(`- 今日已完成 记录于${config.coins.time}`)
		return
	}
	let like_uid_list = await getFavUid()
	if (like_uid_list && like_uid_list.length > 0) {
		let aid = await getFavAid(like_uid_list)
		if (aid !== 0) {
			const body = {
				access_key: config.key,
				aid,
				multiply: 1,
				select_like: 0,
			}
			const myRequest = {
				url: "https://app.bilibili.com/x/v2/view/coin/add",
				headers: {
					...baseHeaders,
					'accept-encoding': 'gzip, deflate, br',
					'content-type': 'application/x-www-form-urlencoded',
					'app-key': 'iphone'
				},
				body: $.queryStr(body)
			}
			await $.fetch(myRequest).then(async response => {
				try {
					const res = $.toObj(response.body)
					if (res?.code === 0) {
						if (res?.message === "0") {
							$.log("- 投币成功")
							config.user.money -= 1
							config.coins.num += 10
							config.coins.time = startTime
							$.setItem($.name + "_daily_bonus", $.toStr(config))
						} 
						else if (res?.message === "OK" || (typeof res?.message === 'string' && res.message.includes("超过投币上限"))) {
							$.log(`- 该视频已投币或达到上限，跳过 (${res.message})`)
							// 不扣硬币，不计失败次数
						} 
						else {
							$.log("- 投币失败,原因 " + (res?.message || "未知错误"))
							config.coins.failures = (config.coins.failures || 0) + 1
							if (config.coins.failures < 8) {  // 优化：最多重试7次
								$.log(`- 正在重试...重试次数 ${config.coins.failures - 1}`)
								await $.wait(500)  // 增加等待时间，降低风控概率
								await coin()
							}
						}
					} else {
						$.log("- 投币接口异常, code: " + res?.code)
						config.coins.failures = (config.coins.failures || 0) + 1
						if (config.coins.failures < 8) {
							await $.wait(500)
							await coin()
						}
					}
				} catch (e) {
					$.logErr(e, response)
				}
			})
		} else {
			$.log("- 获取随机投币视频失败")
		}
	} else {
		$.log("- 获取随机关注用户列表失败")
	}
}

// 优化 getFavUid：增加失败提示
async function getFavUid() {
	const myRequest = {
		url: `https://api.bilibili.com/x/relation/followings?vmid=${config.cookie.DedeUserID}&ps=10&order_type=attention`,
		headers: { ...baseHeaders }
	}
	return await $.fetch(myRequest).then(response => {
		try {
			const body = $.toObj(response.body)
			let like_uid_list = []
			if (body?.code === 0) {
				$.log("- 获取关注列表成功")
				let like_list = body?.data?.list || []
				for (let i = 0; i < like_list.length; i++) {
					like_uid_list[i] = like_list[i].mid
				}
				return like_uid_list
			} else {
				$.log("- 获取关注列表失败")
				$.log("- 原因 " + (body?.message || body?.code || "未知"))
				return like_uid_list
			}
		} catch (e) {
			$.logErr(e, response)
			return []
		}
	})
}